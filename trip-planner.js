// ============================================================
// TripCollective — Trip Planner Data Layer
// trip-planner.js — add before </body> in trip-planner.html
// ============================================================

import { supabase } from './supabase.js';

// Get trip ID from URL: /trip-planner.html?id=uuid
const params = new URLSearchParams(window.location.search);
const TRIP_ID = params.get('id');

let tripData = null;       // the trip row
let allActivities = [];    // all activities for this trip
let currentDay = 1;        // currently selected day tab

let currentUserId = null;
let dataReady = false; // prevents renders before data is loaded

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  if (!TRIP_ID) { window.location.href = 'dashboard.html'; return; }

  currentUserId = session.user.id;

  await Promise.all([
    loadTrip(session.user.id),
    loadActivities(),
  ]);

  dataReady = true;

  wireAddActivityForm(session.user.id);

  // Override setView so switching views re-renders with real data
  // Only fires on explicit user view switches, not on initial load
  const originalSetView = window.setView;
  let initialRenderDone = false;
  window.setView = function(view) {
    originalSetView(view);
    if (!dataReady || !initialRenderDone) return;
    if (view === 'card') renderCurrentDay();
    if (view === 'grid') window.buildGrid();
  };

  // Fix map toggle
  window.toggleMap = function() {
    const panel = document.getElementById('mapPanel');
    const btn = document.querySelector('.map-toggle-btn');
    if (!panel) return;
    const isCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', !isCollapsed);
    if (btn) btn.textContent = isCollapsed ? 'Hide map' : 'Show map';
  };

  // Single initial render — after this, setView handles subsequent switches
  const activeView = document.getElementById('card-view')?.classList.contains('active') ? 'card' : 'grid';
  if (activeView === 'card') renderCurrentDay();
  else window.buildGrid();
  initialRenderDone = true;
});

// ============================================================
// LOAD TRIP
// ============================================================
async function loadTrip(userId) {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, name, destination, start_date, end_date, status, budget, currency, visibility')
    .eq('id', TRIP_ID)
    .limit(1);

  if (error || !trips?.length) {
    console.error('Trip not found:', error?.message);
    window.location.href = 'dashboard.html';
    return;
  }

  tripData = trips[0];
  renderTripHeader(tripData);
}

function renderTripHeader(trip) {
  // Trip name
  const nameEl = document.querySelector('.trip-name');
  if (nameEl) nameEl.textContent = trip.name;

  // Update page title
  document.title = `${trip.name} — TripCollective`;

  // Meta row: dates + budget + status
  const metaRow = document.querySelector('.trip-meta-row');
  if (metaRow) {
    const start = trip.start_date ? formatDate(trip.start_date) : null;
    const end = trip.end_date ? formatDate(trip.end_date) : null;
    const dateStr = start && end ? `${start} – ${end}` : start || '';
    const budget = trip.budget
      ? `${trip.currency || '$'}${Number(trip.budget).toLocaleString()} budget`
      : '';
    const status = trip.status ? capitalize(trip.status) : '';

    metaRow.innerHTML = `
      ${dateStr ? `<span class="trip-meta-item">📅 ${dateStr}</span>` : ''}
      ${budget ? `<span class="trip-meta-item">💰 ${budget}</span>` : ''}
      ${status ? `<span class="badge badge-${trip.status}" style="font-size:0.7rem">
        <span class="badge-dot"></span>${status}
      </span>` : ''}
    `;
  }
}

// ============================================================
// LOAD ACTIVITIES
// ============================================================
async function loadActivities() {
  const { data: activities, error } = await supabase
    .from('activities')
    .select('*')
    .eq('trip_id', TRIP_ID)
    .order('day_number', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('Activities load error:', error.message);
    return;
  }

  allActivities = activities || [];
  buildDayNav();
  // setView override handles the initial render
}

// ============================================================
// DAY NAV
// ============================================================
function buildDayNav() {
  const nav = document.querySelector('.day-nav');
  if (!nav) return;

  // Get unique day numbers
  const days = [...new Set(allActivities.map(a => a.day_number))].sort((a, b) => a - b);

  // If no activities yet, show at least Day 1
  if (days.length === 0) days.push(1);

  nav.innerHTML = days.map((day, i) => {
    const activitiesOnDay = allActivities.filter(a => a.day_number === day);
    const dateStr = activitiesOnDay[0]?.activity_date
      ? formatDayLabel(activitiesOnDay[0].activity_date)
      : `Day ${day}`;

    return `
      <button class="day-tab ${day === currentDay ? 'active' : ''}"
              onclick="selectDay(${day}, this)">
        <div class="day-tab-num">${day}</div>
        <div class="day-tab-label">${dateStr}</div>
        <div class="day-tab-dot"></div>
      </button>
    `;
  }).join('') + `
    <button class="day-nav-add" onclick="addDay()" title="Add day">+</button>
  `;
}

window.selectDay = function(dayNum, el) {
  document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentDay = dayNum;
  const inGrid = document.getElementById('grid-view')?.classList.contains('active');
  if (inGrid) {
    // Scroll the grid header to show selected day
    const gridHeaderRow = document.querySelector('.grid-header-row');
    if (gridHeaderRow) {
      const days = [...new Set(allActivities.map(a => a.day_number))].sort((a,b) => a-b);
      const idx = days.indexOf(dayNum);
      if (idx > -1) {
        const headerCells = gridHeaderRow.querySelectorAll('.grid-day-header');
        if (headerCells[idx]) headerCells[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  } else {
    renderCurrentDay();
  }
};

window.addDay = function() {
  const days = [...new Set(allActivities.map(a => a.day_number))];
  const nextDay = days.length ? Math.max(...days) + 1 : 1;
  currentDay = nextDay;
  // Add a placeholder so the day appears in nav
  allActivities.push({ day_number: nextDay, activity_date: null, id: '__placeholder__' });
  buildDayNav();
  renderCurrentDay();
  // Auto-click the new tab
  const tabs = document.querySelectorAll('.day-tab');
  tabs[tabs.length - 1]?.click();
};

// ============================================================
// RENDER ACTIVITIES FOR CURRENT DAY
// ============================================================
function renderCurrentDay() {
  const dayActivities = allActivities
    .filter(a => a.day_number === currentDay && a.id !== '__placeholder__')
    .sort((a, b) => {
      if (!a.start_time) return 1;
      if (!b.start_time) return -1;
      return a.start_time.localeCompare(b.start_time);
    });

  // ── CARD VIEW ──
  renderCardView(dayActivities);

  // ── GRID VIEW (rebuild if active) ──
  if (document.getElementById('grid-view')?.classList.contains('active')) {
    buildGrid();
  }
}

function renderCardView(activities) {
  const cardView = document.getElementById('card-view');
  if (!cardView) return;

  const dateLabel = activities[0]?.activity_date
    ? formatFullDate(activities[0].activity_date)
    : `Day ${currentDay}`;

  const locationLabel = activities[0]?.location
    ? activities[0].location.split(',').slice(-2).join(',').trim()
    : tripData?.destination || '';

  const dayNum = String(currentDay).padStart(2, '0');

  cardView.innerHTML = `
    <div class="card-view-day">
      <div class="card-day-header">
        <div class="card-day-num">${dayNum}</div>
        <div class="card-day-info">
          <div class="card-day-name">${dateLabel}</div>
          <div class="card-day-meta">📍 ${locationLabel} · ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} planned</div>
        </div>
        <div class="card-day-actions">
          <button class="btn btn-ghost btn-sm" onclick="openActivityModal()">+ Add</button>
        </div>
      </div>

      <div class="card-activities">
        ${activities.length === 0
          ? `<div style="text-align:center;padding:2rem;color:var(--text-muted)">No activities yet — add one above.</div>`
          : activities.map(a => renderActivityCard(a)).join('')
        }
        <button class="card-add-activity" onclick="openActivityModal()">
          + Add activity to Day ${currentDay}
        </button>
      </div>
    </div>
  `;
}

function renderActivityCard(a) {
  const cfg = getCategoryConfig(a.category);
  const timeStr = a.start_time ? formatTime(a.start_time) : '';
  const duration = a.duration_minutes ? formatDuration(a.duration_minutes) : '';

  return `
    <div class="card-activity" data-activity-id="${a.id}">
      <div class="card-activity-time">${timeStr}</div>
      <div class="card-activity-bar" style="background:${cfg.color}"></div>
      <div class="card-activity-body">
        <div class="card-activity-name">${escapeHtml(a.name)}</div>
        <div class="card-activity-meta">
          <span>${cfg.icon} ${cfg.label}${duration ? ` · ${duration}` : ''}</span>
          ${a.source ? `<span class="card-activity-source">${escapeHtml(a.source)}</span>` : ''}
        </div>
        ${a.location ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px">📍 ${escapeHtml(a.location)}</div>` : ''}
        ${a.personal_note ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${escapeHtml(a.personal_note)}</div>` : ''}
        ${a.tip ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">💡 ${escapeHtml(a.tip)}</div>` : ''}
      </div>
      <div class="card-activity-actions">
        <button class="btn btn-icon" style="width:26px;height:26px;font-size:0.7rem"
                onclick="openEditActivity('${a.id}')" title="Edit">✏️</button>
        <button class="btn btn-icon" style="width:26px;height:26px;font-size:0.7rem"
                onclick="confirmDeleteActivity('${a.id}')" title="Delete">🗑</button>
      </div>
    </div>
  `;
}

// ============================================================
// GRID VIEW
// ============================================================
const TIME_SLOTS = [
  '6a','7a','8a','9a','10a','11a','12p',
  '1p','2p','3p','4p','5p','6p','7p','8p','9p','10p'
];

// Override the existing buildGrid to use real data
window.buildGrid = async function() {
  const body = document.getElementById('gridBody');
  if (!body) return;

  const days = [...new Set(allActivities.map(a => a.day_number))].sort((a,b) => a-b);
  if (days.length === 0) {
    body.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">No activities yet.</p>';
    return;
  }

  // Set CSS variable on scroll wrapper
  const gridView = document.getElementById('grid-view');
  const scrollWrap = gridView?.querySelector('.grid-scroll-wrap');
  const target = scrollWrap || gridView;
  if (target) target.style.setProperty('--day-count', days.length);

  const colTemplate = `56px repeat(${days.length}, 140px)`;

  // Load reservations for hotel row
  let hotels = [];
  try {
    const { data } = await supabase
      .from('reservations')
      .select('name, start_datetime, end_datetime, type')
      .eq('trip_id', TRIP_ID)
      .eq('type', 'hotel');
    hotels = data || [];
  } catch(e) {}

  // Build hotel row HTML — span across days covered by reservation
  function getHotelForDay(dayNum) {
    const acts = allActivities.filter(a => a.day_number === dayNum);
    const dateStr = acts[0]?.activity_date;
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return hotels.find(h => {
      const start = new Date(h.start_datetime);
      const end = new Date(h.end_datetime);
      return date >= start && date < end;
    });
  }

  // Update grid header
  const gridHeaderRow = document.querySelector('.grid-header-row');
  if (gridHeaderRow) {
    gridHeaderRow.style.gridTemplateColumns = colTemplate;
    gridHeaderRow.innerHTML = `<div class="grid-time-header">TIME</div>` +
      days.map(d => {
        const acts = allActivities.filter(a => a.day_number === d);
        const date = acts[0]?.activity_date ? new Date(acts[0].activity_date) : null;
        const dayName = date ? date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : `DAY ${d}`;
        const dayNum = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const location = acts[0]?.location ? acts[0].location.split(',')[0] : '';
        return `
          <div class="grid-day-header">
            <div class="grid-day-name">${dayName}</div>
            <div class="grid-day-date">${dayNum}</div>
            ${location ? `<div class="grid-day-location">📍 ${location}</div>` : ''}
          </div>`;
      }).join('');
  }

  // Hotel row — just below header
  let hotelRowEl = document.getElementById('grid-hotel-row');
  if (!hotelRowEl) {
    hotelRowEl = document.createElement('div');
    hotelRowEl.id = 'grid-hotel-row';
    hotelRowEl.className = 'grid-hotel-row';
    gridHeaderRow?.after(hotelRowEl);
  }
  if (hotels.length > 0) {
    let hotelHtml = `<div class="grid-hotel-label">🏨</div>`;
    days.forEach(d => {
      const hotel = getHotelForDay(d);
      // Check if this is the first day of this hotel stay
      const prevHotel = d > days[0] ? getHotelForDay(days[days.indexOf(d) - 1]) : null;
      if (hotel && hotel !== prevHotel) {
        // Count how many consecutive days this hotel spans
        let span = 0;
        for (let i = days.indexOf(d); i < days.length; i++) {
          if (getHotelForDay(days[i]) === hotel) span++;
          else break;
        }
        hotelHtml += `<div class="grid-hotel-cell grid-hotel-cell--filled" style="grid-column: span ${span}">
          <span>${escapeHtml(hotel.name)}</span>
        </div>`;
      } else if (!hotel) {
        hotelHtml += `<div class="grid-hotel-cell"></div>`;
      }
      // If same hotel as previous day, it's already spanned — skip
    });
    hotelRowEl.innerHTML = hotelHtml;
    hotelRowEl.style.display = 'grid';
    hotelRowEl.style.gridTemplateColumns = colTemplate;
  } else {
    hotelRowEl.style.display = 'none';
  }

  // Build time → activity lookup per day
  const byDay = {};
  days.forEach(d => { byDay[d] = {}; });
  allActivities.forEach(a => {
    if (!a.start_time || !byDay[a.day_number]) return;
    const slot = timeToSlot(a.start_time);
    if (slot) byDay[a.day_number][slot] = a;
  });

  body.innerHTML = '';
  TIME_SLOTS.forEach(slot => {
    const row = document.createElement('div');
    row.className = 'grid-row';
    row.style.gridTemplateColumns = colTemplate;
    // Time cell is sticky
    let html = `<div class="grid-time-cell grid-time-cell--sticky">${slot}</div>`;
    days.forEach(d => {
      const a = byDay[d]?.[slot];
      if (a) {
        const cfg = getCategoryConfig(a.category);
        html += `<div class="grid-cell">
          <div class="grid-activity cat-${a.category || 'other'}"
               onclick="openEditActivity('${a.id}')">
            <div class="grid-activity-name">${escapeHtml(a.name)}</div>
            <div class="grid-activity-source">${a.source ? escapeHtml(a.source) : cfg.label}</div>
          </div>
        </div>`;
      } else {
        html += `<div class="grid-cell" onclick="openActivityModal()"></div>`;
      }
    });
    row.innerHTML = html;
    body.appendChild(row);
  });
};

// ============================================================
// ADD ACTIVITY — wire the existing modal form to save to DB
// ============================================================
function wireAddActivityForm(userId) {
  // Replace the existing "Add to itinerary" button behavior
  const saveBtn = document.querySelector('#activityModal .btn-primary');
  if (!saveBtn) return;

  saveBtn.onclick = async (e) => {
    e.preventDefault();
    await saveActivity(userId);
  };
}

async function saveActivity(userId) {
  const modal = document.getElementById('activityModal');

  const name = modal.querySelector('input[placeholder*="Sunset"], input[placeholder*="activity"], .form-input[type="text"]')?.value?.trim();
  if (!name) { alert('Please enter an activity name.'); return; }

  const selectedCat = modal.querySelector('.cat-option.selected');
  const category = selectedCat?.textContent?.trim().toLowerCase().replace(/[^a-z]/g,'') || 'other';

  const timeInput = modal.querySelector('input[type="time"]')?.value || null;
  const notesInput = modal.querySelectorAll('input[type="text"]')[1]?.value?.trim() || null;

  const selectedSource = modal.querySelector('.source-pill.selected')?.textContent?.trim() || null;

  const { data, error } = await supabase
    .from('activities')
    .insert({
      trip_id: TRIP_ID,
      day_number: currentDay,
      activity_date: getDateForDay(currentDay),
      name,
      category,
      start_time: timeInput || null,
      source: selectedSource,
      personal_note: notesInput,
      created_by: userId,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Save activity error:', error.message);
    alert('Could not save activity. Please try again.');
    return;
  }

  allActivities.push(data);
  allActivities.sort((a,b) => a.day_number - b.day_number || (a.start_time || '').localeCompare(b.start_time || ''));

  closeActivityModal();
  renderCurrentDay();
  showToast('Activity added!');
}

// ============================================================
// EDIT ACTIVITY
// ============================================================
window.openEditActivity = function(activityId) {
  const a = allActivities.find(x => x.id === activityId);
  if (!a) return;

  const modal = document.getElementById('activityModal');
  const title = modal.querySelector('.activity-modal-title');
  if (title) title.textContent = 'Edit Activity';

  // Pre-fill name
  const nameInput = modal.querySelector('input[type="text"]');
  if (nameInput) nameInput.value = a.name;

  // Pre-fill time
  const timeInput = modal.querySelector('input[type="time"]');
  if (timeInput && a.start_time) timeInput.value = a.start_time.slice(0,5);

  // Pre-fill notes
  const notesInputs = modal.querySelectorAll('input[type="text"]');
  if (notesInputs[1] && a.personal_note) notesInputs[1].value = a.personal_note;

  // Pre-select category
  modal.querySelectorAll('.cat-option').forEach(btn => {
    btn.classList.remove('selected');
    const catText = btn.textContent.trim().toLowerCase().replace(/[^a-z]/g,'');
    if (catText === (a.category || '').replace(/[^a-z]/g,'')) btn.classList.add('selected');
  });

  // Pre-select source
  modal.querySelectorAll('.source-pill').forEach(btn => {
    btn.classList.toggle('selected', btn.textContent.trim() === a.source);
  });

  // Inject day-change selector (once; reuse on subsequent edits)
  let dayRow = modal.querySelector('.edit-day-row');
  if (!dayRow) {
    dayRow = document.createElement('div');
    dayRow.className = 'form-group edit-day-row';
    dayRow.innerHTML = '<label class="form-label">Move to day</label><select class="form-input edit-day-select"></select>';
    // Insert after the time/duration row
    const timeGrid = modal.querySelector('[style*="grid-template-columns"]');
    if (timeGrid) timeGrid.after(dayRow);
    else modal.querySelector('.form-group').after(dayRow);
  }
  const daySelect = dayRow.querySelector('.edit-day-select');
  const knownDays = [...new Set(allActivities.map(x => x.day_number))]
    .filter(d => d !== undefined)
    .sort((x, y) => x - y);
  daySelect.innerHTML = knownDays.map(d => {
    const acts = allActivities.filter(x => x.day_number === d);
    const dateStr = acts[0]?.activity_date ? formatDayLabel(acts[0].activity_date) : '';
    const label = dateStr ? `Day ${d} — ${dateStr}` : `Day ${d}`;
    return `<option value="${d}" ${d === a.day_number ? 'selected' : ''}>${label}</option>`;
  }).join('');

  // Switch save button to update mode
  const saveBtn = modal.querySelector('.btn-primary');
  if (saveBtn) {
    saveBtn.textContent = 'Save Changes';
    saveBtn.onclick = async (e) => {
      e.preventDefault();
      await updateActivity(activityId);
    };
  }

  modal.classList.add('open');
};

async function updateActivity(activityId) {
  const modal = document.getElementById('activityModal');
  const name = modal.querySelector('input[type="text"]')?.value?.trim();
  if (!name) { alert('Activity name is required.'); return; }

  const selectedCat = modal.querySelector('.cat-option.selected');
  const category = selectedCat?.textContent?.trim().toLowerCase().replace(/[^a-z]/g,'') || 'other';
  const timeInput = modal.querySelector('input[type="time"]')?.value || null;
  const notesInputs = modal.querySelectorAll('input[type="text"]');
  const personalNote = notesInputs[1]?.value?.trim() || null;
  const selectedSource = modal.querySelector('.source-pill.selected')?.textContent?.trim() || null;

  // Read day selector — may be present when editing (not when adding)
  const daySelect = modal.querySelector('.edit-day-select');
  const newDayNumber = daySelect ? parseInt(daySelect.value, 10) : null;
  const newActivityDate = newDayNumber ? getDateForDay(newDayNumber) : null;

  // Build update payload — only include day fields if a day was selected
  const updatePayload = { name, category, start_time: timeInput, personal_note: personalNote, source: selectedSource };
  if (newDayNumber !== null) {
    updatePayload.day_number = newDayNumber;
    updatePayload.activity_date = newActivityDate;
  }

  const { error } = await supabase
    .from('activities')
    .update(updatePayload)
    .eq('id', activityId);

  if (error) { alert('Could not update activity.'); return; }

  // Update in local array
  const idx = allActivities.findIndex(a => a.id === activityId);
  if (idx > -1) {
    allActivities[idx] = { ...allActivities[idx], ...updatePayload };
  }

  // Re-sort local array after potential day change
  allActivities.sort((a, b) => a.day_number - b.day_number || (a.start_time || '').localeCompare(b.start_time || ''));

  // Reset modal — remove day row so it doesn't appear on next Add
  const dayRow = modal.querySelector('.edit-day-row');
  if (dayRow) dayRow.remove();
  const title = modal.querySelector('.activity-modal-title');
  if (title) title.textContent = 'Add Activity';
  const saveBtn = modal.querySelector('.btn-primary');
  if (saveBtn) {
    saveBtn.textContent = 'Add to itinerary';
    saveBtn.onclick = async (e) => { e.preventDefault(); await saveActivity(currentUserId); };
  }

  // If day changed, rebuild day nav in case it affects which days exist
  if (newDayNumber !== null) buildDayNav();

  closeActivityModal();
  renderCurrentDay();
  showToast('Activity updated!');
}

window.confirmDeleteActivity = function(activityId) {
  if (!confirm('Delete this activity?')) return;
  deleteActivity(activityId);
};

async function deleteActivity(activityId) {
  const { error } = await supabase
    .from('activities')
    .delete()
    .eq('id', activityId);

  if (error) { console.error('Delete error:', error.message); return; }

  allActivities = allActivities.filter(a => a.id !== activityId);
  renderCurrentDay();
  showToast('Activity removed.');
}

// ============================================================
// HELPERS
// ============================================================
function getCategoryConfig(cat) {
  const map = {
    travel:        { icon: '✈️', label: 'Travel',       color: 'var(--periwinkle)' },
    food:          { icon: '🍴', label: 'Food & Drink', color: 'var(--success)' },
    outdoor:       { icon: '🥾', label: 'Outdoors',     color: 'var(--accent)' },
    activity:      { icon: '🏛', label: 'Culture',      color: 'var(--secondary)' },
    culture:       { icon: '🏛', label: 'Culture',      color: 'var(--secondary)' },
    nightlife:     { icon: '🌙', label: 'Nightlife',    color: '#2C2038' },
    accommodation: { icon: '🏨', label: 'Stay',         color: 'var(--primary)' },
  };
  return map[cat] || { icon: '📍', label: capitalize(cat || 'other'), color: 'var(--border)' };
}

function getDateForDay(dayNum) {
  if (!tripData?.start_date) return null;
  const start = new Date(tripData.start_date);
  start.setDate(start.getDate() + dayNum - 1);
  return start.toISOString().split('T')[0];
}

function timeToSlot(timeStr) {
  if (!timeStr) return null;
  const [h] = timeStr.split(':').map(Number);
  if (h < 6) return null;
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'p' : 'a';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2,'0')}${ampm}`;
}

function formatDuration(mins) {
  if (!mins) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDayLabel(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg) {
  const existing = document.querySelector('.tc-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'tc-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;bottom:2rem;right:2rem;z-index:9999;
    background:#E8856A;color:#fff;padding:.75rem 1.25rem;
    border-radius:8px;font-family:'DM Sans',sans-serif;font-size:.875rem;
    transition:opacity .3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; setTimeout(()=>toast.remove(),300); }, 3000);
}
