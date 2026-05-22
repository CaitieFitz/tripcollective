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
    // Day nav only relevant in card/list view
    const dayNav = document.getElementById('dayNav');
    if (dayNav) dayNav.style.display = view === 'grid' ? 'none' : '';
    if (!dataReady || !initialRenderDone) return;
    if (view === 'card') renderCurrentDay();
    if (view === 'grid') window.buildGrid();
  };

  // Fix map toggle
  window.toggleMap = function() {
    const panel = document.getElementById('mapPanel');
    const btn = document.querySelector('.map-toggle-btn');
    const reopenBtn = document.getElementById('map-reopen-btn');
    if (!panel) return;
    const isCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', !isCollapsed);
    if (btn) btn.textContent = isCollapsed ? 'Hide map' : 'Show map';
    // Only show reopen btn when on itinerary tab and map is now collapsed
    const onItinerary = document.querySelector('.section-tab.active')?.dataset?.section === 'itinerary';
    if (reopenBtn) reopenBtn.style.display = (onItinerary && !isCollapsed) ? 'block' : 'none';
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

  const gridView = document.getElementById('grid-view');
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

  // Hotel row — sits at top of scrollable body (scrolls with content)
  let hotelRowEl = document.getElementById('grid-hotel-row');
  if (!hotelRowEl) {
    hotelRowEl = document.createElement('div');
    hotelRowEl.id = 'grid-hotel-row';
    hotelRowEl.className = 'grid-hotel-row';
    body.prepend(hotelRowEl);
  } else {
    // Make sure it's at the top of body (not inside header wrap)
    body.prepend(hotelRowEl);
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

  // Sync horizontal scroll between header wrap and body scroll wrap
  const headerWrap = document.getElementById('gridHeaderWrap');
  const scrollWrap = document.getElementById('gridScrollWrap');
  if (headerWrap && scrollWrap) {
    // Remove old listeners before adding new ones
    const newScrollWrap = scrollWrap.cloneNode(false);
    while (scrollWrap.firstChild) newScrollWrap.appendChild(scrollWrap.firstChild);
    scrollWrap.parentNode.replaceChild(newScrollWrap, scrollWrap);
    newScrollWrap.addEventListener('scroll', () => {
      headerWrap.scrollLeft = newScrollWrap.scrollLeft;
    });
  }

  body.innerHTML = '';
  // Re-add hotel row after clearing body
  body.prepend(hotelRowEl);

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


// ============================================================
// SECTION TABS — Reservations / Travellers / Notes / Trip Intel
// ============================================================

let reservationsLoaded = false;
let travellersLoaded = false;
let notesLoaded = false;
let intelLoaded = false;

window.onSectionSwitch = function(name) {
  const isItinerary = name === 'itinerary';

  // Show/hide the day nav, category legend, budget bar
  const chrome = document.getElementById('itinerary-chrome');
  if (chrome) chrome.classList.toggle('hidden', !isItinerary);

  // Show/hide the view toggle and + Add Activity button (only useful on itinerary)
  const viewToggle = document.querySelector('.view-toggle');
  const addBtn = document.querySelector('.trip-header-right .btn-primary');
  if (viewToggle) viewToggle.style.display = isItinerary ? '' : 'none';
  if (addBtn) addBtn.style.display = isItinerary ? '' : 'none';

  // Map reopen button — only show on itinerary when map is collapsed
  const mapReopenBtn = document.getElementById('map-reopen-btn');
  const mapPanel = document.getElementById('mapPanel');
  if (mapReopenBtn) {
    const mapCollapsed = mapPanel?.classList.contains('collapsed');
    mapReopenBtn.style.display = (isItinerary && mapCollapsed) ? 'block' : 'none';
  }

  if (name === 'reservations' && !reservationsLoaded) {
    reservationsLoaded = true;
    renderReservations();
  }
  if (name === 'travellers' && !travellersLoaded) {
    travellersLoaded = true;
    renderTravellers();
  }
  if (name === 'notes' && !notesLoaded) {
    notesLoaded = true;
    renderNotes();
  }
  if (name === 'intel' && !intelLoaded) {
    intelLoaded = true;
    renderTripIntel();
  }
};

// ── RESERVATIONS ──
const TYPE_LABELS = { flight: 'Flights', hotel: 'Hotels & Accommodation', car: 'Car Rentals', tour: 'Tours & Experiences', other: 'Other' };
const TYPE_ICONS  = { flight: '✈️', hotel: '🏨', car: '🚗', tour: '🎟', other: '📋' };
const TYPE_ORDER  = ['flight', 'hotel', 'car', 'tour', 'other'];

let allReservations = [];

// Aurora avatar color palette — cycles by index
const AURORA_COLORS = ['#E8856A','#EBA8B8','#A89FC8','#8FA3D4','#2BA176'];
function auroraColor(index) { return AURORA_COLORS[index % AURORA_COLORS.length]; }

// Active filter — array of traveller IDs (empty = show all)
let resFilterIds = [];

async function renderReservations() {
  const el = document.getElementById('reservations-content');
  if (!el) return;

  // Fetch reservations + their traveller links in one go
  const { data, error } = await supabase
    .from('reservations')
    .select(`
      *,
      reservation_travellers (
        traveller_id,
        travellers ( id, name )
      )
    `)
    .eq('trip_id', TRIP_ID)
    .order('start_datetime', { ascending: true });

  if (error) {
    el.innerHTML = `<div style="padding:2rem;color:var(--text-muted)">Could not load reservations.</div>`;
    return;
  }

  allReservations = data || [];
  resFilterIds = [];
  renderReservationsList();
}

function renderReservationsList() {
  const el = document.getElementById('reservations-content');
  if (!el) return;

  // Collect all unique travellers across all reservations for filter bar
  const travMap = {};
  allReservations.forEach(r => {
    (r.reservation_travellers || []).forEach(rt => {
      if (rt.travellers) travMap[rt.travellers.id] = rt.travellers.name;
    });
  });
  const allTravIds = Object.keys(travMap);

  // ── Filter bar ──
  let filterHtml = '';
  if (allTravIds.length > 0) {
    filterHtml = `<div id="res-filter-bar" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:14px">
      <span style="font-size:0.72rem;color:var(--text-muted);margin-right:2px">Filter:</span>
      <button class="res-filter-pill ${resFilterIds.length === 0 ? 'active' : ''}"
              onclick="setResFilter(null)">All</button>
      ${allTravIds.map(id => {
        const name = travMap[id];
        const initials = name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
        const active = resFilterIds.includes(id);
        const pillColor = auroraColor(Object.keys(travMap).indexOf(id));
        return `<button class="res-filter-pill ${active ? 'active' : ''}"
                  data-filter-id="${id}"
                  style="${active ? `background:${pillColor}22;border-color:${pillColor};color:${pillColor}` : ''}"
                  onclick="toggleResFilter('${id}')">${initials} ${name.split(' ')[0]}</button>`;
      }).join('')}
    </div>`;
  }

  // Header row
  let html = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="btn btn-primary btn-sm" onclick="openResModal()">+ Add reservation</button>
  </div>
  ${filterHtml}`;

  if (allReservations.length === 0) {
    html += `<div style="text-align:center;padding:3rem 1rem;color:var(--text-muted)">
      No reservations yet — add your first one above.
    </div>`;
    el.innerHTML = html;
    return;
  }

  // Apply filter
  const filtered = resFilterIds.length === 0 ? allReservations : allReservations.filter(r => {
    const rTravIds = (r.reservation_travellers || []).map(rt => rt.traveller_id);
    return resFilterIds.every(fid => rTravIds.includes(fid));
  });

  // Group by type
  const grouped = {};
  filtered.forEach(r => {
    const t = r.type || 'other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(r);
  });

  let hasAny = false;
  TYPE_ORDER.forEach(type => {
    if (!grouped[type]) return;
    hasAny = true;
    html += `<div class="sp-section">
      <div class="sp-section-title">${TYPE_LABELS[type] || type}</div>`;
    grouped[type].forEach(r => {
      const start = r.start_datetime ? new Date(r.start_datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const end   = r.end_datetime   ? new Date(r.end_datetime).toLocaleDateString('en-US',   { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const startTime = r.start_datetime ? new Date(r.start_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      const dateDetail = start && end && start !== end
        ? `${start} – ${end}`
        : start + (startTime ? ` · ${startTime}` : '');

      // Travellers for this reservation
      const resTravellers = (r.reservation_travellers || [])
        .map(rt => rt.travellers).filter(Boolean);
      const travAvatars = resTravellers.length > 0
        ? `<div style="display:flex;align-items:center;gap:0;margin-top:8px">
            ${resTravellers.map((t, i) => {
              const ini = t.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
              return `<div class="res-trav-avatar" style="background:${auroraColor(i)}" title="${escapeHtml(t.name)}">${ini}</div>`;
            }).join('')}
            ${resTravellers.length > 1 ? `<span style="font-size:0.68rem;color:var(--text-muted);margin-left:8px">${resTravellers.map(t=>t.name.split(' ')[0]).join(', ')}</span>` : `<span style="font-size:0.68rem;color:var(--text-muted);margin-left:7px">${resTravellers[0].name.split(' ')[0]}</span>`}
           </div>`
        : '';

      html += `<div class="res-card">
        <div class="res-icon res-icon-${type}">${TYPE_ICONS[type] || '📋'}</div>
        <div style="flex:1;min-width:0">
          <div class="res-name">${escapeHtml(r.name || '')}</div>
          <div class="res-detail">${dateDetail}${r.location ? ` · 📍 ${escapeHtml(r.location)}` : ''}</div>
          ${r.notes ? `<div class="res-detail" style="margin-top:4px;white-space:pre-line">${escapeHtml(r.notes)}</div>` : ''}
          ${travAvatars}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;align-self:flex-start">
          <button class="btn btn-icon" style="width:26px;height:26px;font-size:0.7rem"
                  onclick="openEditReservation('${r.id}')" title="Edit">✏️</button>
          <button class="btn btn-icon" style="width:26px;height:26px;font-size:0.7rem"
                  onclick="confirmDeleteReservation('${r.id}')" title="Delete">🗑</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  });

  if (!hasAny) {
    html += `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.82rem">
      No reservations match the selected travellers.
    </div>`;
  }

  el.innerHTML = html;
}

window.setResFilter = function(id) {
  resFilterIds = [];
  renderReservationsList();
};

window.toggleResFilter = function(id) {
  if (resFilterIds.includes(id)) {
    resFilterIds = resFilterIds.filter(x => x !== id);
  } else {
    resFilterIds.push(id);
  }
  renderReservationsList();
};

window.openEditReservation = async function(id) {
  const r = allReservations.find(x => x.id === id);
  if (!r) return;

  // Pre-fill type
  document.querySelectorAll('.res-type-btn').forEach(b => b.classList.remove('selected'));
  const typeBtn = document.querySelector(`.res-type-btn[data-type="${r.type || 'other'}"]`);
  if (typeBtn) { typeBtn.classList.add('selected'); selectResType(typeBtn); }

  // Pre-fill fields
  document.getElementById('resName').value = r.name || '';
  document.getElementById('resLocation').value = r.location || '';
  document.getElementById('resNotes').value = r.notes || '';

  // Dates — stored as datetime, split for date/time inputs
  if (r.start_datetime) {
    const d = new Date(r.start_datetime);
    document.getElementById('resStartDate').value = d.toISOString().split('T')[0];
    document.getElementById('resStartTime').value = d.toTimeString().slice(0,5);
  } else {
    document.getElementById('resStartDate').value = '';
    document.getElementById('resStartTime').value = '';
  }
  if (r.end_datetime) {
    const d = new Date(r.end_datetime);
    document.getElementById('resEndDate').value = d.toISOString().split('T')[0];
    document.getElementById('resEndTime').value = d.toTimeString().slice(0,5);
  } else {
    document.getElementById('resEndDate').value = '';
    document.getElementById('resEndTime').value = '';
  }

  openResModal(id);

  // Load which travellers are already linked
  const { data: links } = await supabase
    .from('reservation_travellers')
    .select('traveller_id')
    .eq('reservation_id', id);
  const selectedIds = (links || []).map(l => l.traveller_id);
  populateResTravellerChecks(selectedIds);
};

// Populate traveller checkboxes in reservation modal
async function populateResTravellerChecks(selectedIds = []) {
  const container = document.getElementById('resTravellerChecks');
  if (!container) return;

  // Use cached allTravellers if available, otherwise fetch
  let travellers = allTravellers;
  if (!travellers || travellers.length === 0) {
    const { data } = await supabase
      .from('travellers').select('id, name').eq('trip_id', TRIP_ID);
    travellers = data || [];
  }

  if (travellers.length === 0) {
    container.innerHTML = `<span style="font-size:0.72rem;color:var(--text-muted)">Add travellers first in the Travellers tab.</span>`;
    return;
  }

  container.innerHTML = travellers.map(t => {
    const checked = selectedIds.includes(t.id);
    const initials = t.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    return `<button type="button"
      class="trav-check-pill ${checked ? 'checked' : ''}"
      data-trav-id="${t.id}"
      onclick="this.classList.toggle('checked')">
      <span class="pill-dot"></span>${escapeHtml(initials)} ${escapeHtml(t.name.split(' ')[0])}
    </button>`;
  }).join('');
}

window.confirmDeleteReservation = function(id) {
  if (!confirm('Delete this reservation?')) return;
  deleteReservation(id);
};

async function deleteReservation(id) {
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  if (error) { showToast('Could not delete reservation.'); return; }
  allReservations = allReservations.filter(r => r.id !== id);
  renderReservationsList();
  showToast('Reservation deleted.');
}

window.populateResTravellerChecks = populateResTravellerChecks;
window.saveReservation = async function() {
  const modal = document.getElementById('resModal');
  const editId = modal.dataset.editId || null;

  const name = document.getElementById('resName').value.trim();
  if (!name) { alert('Please enter a name for this reservation.'); return; }

  const type = document.querySelector('.res-type-btn.selected')?.dataset?.type || 'other';
  const location = document.getElementById('resLocation').value.trim() || null;
  const notes = document.getElementById('resNotes').value.trim() || null;

  // Combine date + time into ISO datetime strings
  const startDate = document.getElementById('resStartDate').value;
  const startTime = document.getElementById('resStartTime').value || '00:00';
  const endDate   = document.getElementById('resEndDate').value;
  const endTime   = document.getElementById('resEndTime').value || '00:00';

  const start_datetime = startDate ? new Date(`${startDate}T${startTime}`).toISOString() : null;
  const end_datetime   = endDate   ? new Date(`${endDate}T${endTime}`).toISOString()     : null;

  const payload = { trip_id: TRIP_ID, type, name, location, notes, start_datetime, end_datetime };

  const saveBtn = document.getElementById('resSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  let error;
  if (editId) {
    const res = await supabase.from('reservations').update(payload).eq('id', editId);
    error = res.error;
    if (!error) {
      const idx = allReservations.findIndex(r => r.id === editId);
      if (idx > -1) allReservations[idx] = { ...allReservations[idx], ...payload };
    }
  } else {
    const res = await supabase.from('reservations').insert(payload).select().single();
    error = res.error;
    if (!error && res.data) allReservations.push(res.data);
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editId ? 'Save changes' : 'Add reservation'; }

  if (error) {
    console.error('Reservation save error:', error);
    showToast('Could not save reservation: ' + error.message);
    return;
  }

  // Re-sort by start_datetime
  allReservations.sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || ''));

  // Save reservation_travellers links
  const checkedIds = [...document.querySelectorAll('.trav-check-pill.checked')]
    .map(el => el.dataset.travId).filter(Boolean);
  const savedResId = editId || res?.data?.id;
  if (savedResId) {
    // Delete existing links then re-insert
    await supabase.from('reservation_travellers').delete().eq('reservation_id', savedResId);
    if (checkedIds.length > 0) {
      await supabase.from('reservation_travellers').insert(
        checkedIds.map(tid => ({ reservation_id: savedResId, traveller_id: tid }))
      );
    }
  }

  closeResModal();
  renderReservationsList();
  // Refresh travellers tab if it was already loaded so reservation links update
  if (travellersLoaded) {
    travellersLoaded = false;
    renderTravellers();
  }
  showToast(editId ? 'Reservation updated!' : 'Reservation added!');
};

// ── TRAVELLERS ──
let allTravellers = [];

async function renderTravellers() {
  const el = document.getElementById('travellers-content');
  if (!el) return;

  // Ensure the trip owner is in the travellers table
  await ensureOwnerTraveller();

  // Load from travellers table, with their linked reservations
  const { data, error } = await supabase
    .from('travellers')
    .select(`
      *,
      reservation_travellers (
        reservation_id,
        reservations ( id, type, name, start_datetime, end_datetime )
      )
    `)
    .eq('trip_id', TRIP_ID)
    .order('created_at', { ascending: true });

  if (error) {
    el.innerHTML = `<div style="padding:2rem;color:var(--text-muted)">Could not load travellers: ${error.message}</div>`;
    return;
  }

  allTravellers = data || [];
  renderTravellersList();
}

async function ensureOwnerTraveller() {
  // Check if owner already exists in travellers table
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  const { data: existing } = await supabase
    .from('travellers')
    .select('id')
    .eq('trip_id', TRIP_ID)
    .eq('user_id', userId)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Fetch profile info
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, phone, emergency_contact_name, emergency_contact_phone')
    .eq('id', userId)
    .single();

  await supabase.from('travellers').insert({
    trip_id: TRIP_ID,
    user_id: userId,
    name: profile?.full_name || session.user.email?.split('@')[0] || 'Trip Owner',
    phone: profile?.phone || null,
    emergency_contact_name: profile?.emergency_contact_name || null,
    emergency_contact_phone: profile?.emergency_contact_phone || null,
  });
}

function renderTravellersList() {
  const el = document.getElementById('travellers-content');
  if (!el) return;

  let html = `<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:16px">
    <button class="btn btn-primary btn-sm" onclick="openAddTravellerModal()">+ Add traveller</button>
  </div>`;

  if (allTravellers.length === 0) {
    html += `<div style="text-align:center;padding:3rem 1rem;color:var(--text-muted)">No travellers yet.</div>`;
    el.innerHTML = html;
    return;
  }

  allTravellers.forEach((t, idx) => {
    const initials = t.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    const linkedRes = (t.reservation_travellers || [])
      .map(rt => rt.reservations)
      .filter(Boolean)
      .sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || ''));

    html += `<div class="trav-card">
      <div class="trav-header">
        <div class="trav-avatar" style="background:${auroraColor(idx)};color:white">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="trav-name">${escapeHtml(t.name)}</div>
          ${t.user_id ? '<div class="trav-role">TripCollective member</div>' : '<div class="trav-role">Guest traveller</div>'}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn btn-icon" style="width:28px;height:28px;font-size:0.7rem"
                  onclick="openEditTraveller('${t.id}')" title="Edit">✏️</button>
          <button class="btn btn-icon" style="width:28px;height:28px;font-size:0.7rem"
                  onclick="confirmDeleteTraveller('${t.id}')" title="Remove">🗑</button>
        </div>
      </div>
      <div class="trav-fields">
        ${t.phone ? `<div class="trav-field"><div class="trav-field-label">Phone</div><div class="trav-field-val">${escapeHtml(t.phone)}</div></div>` : ''}
        ${t.emergency_contact_name ? `<div class="trav-field"><div class="trav-field-label">Emergency contact</div><div class="trav-field-val">${escapeHtml(t.emergency_contact_name)}${t.emergency_contact_phone ? ` · ${escapeHtml(t.emergency_contact_phone)}` : ''}</div></div>` : ''}
      </div>
      ${linkedRes.length > 0 ? `
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
        <div class="trav-field-label" style="margin-bottom:6px">Reservations</div>
        ${linkedRes.map(r => {
          const icon = TYPE_ICONS[r.type] || '📋';
          const date = r.start_datetime ? new Date(r.start_datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          return `<div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;padding:3px 0">
            <span>${icon}</span>
            <span style="flex:1">${escapeHtml(r.name || '')}</span>
            <span style="color:var(--text-muted)">${date}</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>`;
  });

  el.innerHTML = html;
}

// ── ADD / EDIT TRAVELLER MODAL (injected into DOM) ──
function openAddTravellerModal(editId) {
  const editing = editId ? allTravellers.find(t => t.id === editId) : null;

  let modal = document.getElementById('travModalOverlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'travModalOverlay';
    modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(44,32,56,0.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:20px;width:100%;max-width:460px;padding:24px;box-shadow:0 20px 60px rgba(44,32,56,0.2);max-height:90vh;overflow-y:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h2 style="font-family:var(--font-display);font-size:1.2rem;font-weight:600" id="travModalTitle">Add Traveller</h2>
          <button class="btn btn-icon" onclick="closeTravModal()">✕</button>
        </div>

        <div id="travLookupSection">
          <div class="form-group">
            <label class="form-label">Email (optional — links to TripCollective account)</label>
            <div style="display:flex;gap:8px">
              <input class="form-input" type="email" id="travEmail" placeholder="their@email.com" style="flex:1">
              <button class="btn btn-ghost btn-sm" onclick="lookupTraveller()" style="flex-shrink:0">Look up</button>
            </div>
            <div id="travLookupResult" style="font-size:0.72rem;margin-top:6px;color:var(--text-muted)"></div>
          </div>
          <div class="divider"></div>
        </div>

        <input type="hidden" id="travUserId">

        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" type="text" id="travName" placeholder="Full name">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-input" type="tel" id="travPhone" placeholder="+1 305 555 0100">
        </div>
        <div style="border-top:1px solid var(--border);margin:12px 0 10px"></div>
        <div style="font-size:0.72rem;font-weight:500;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em">Emergency Contact</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input" type="text" id="travEmergencyName" placeholder="Full name">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-input" type="tel" id="travEmergencyPhone" placeholder="+1 305 555 0101">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="travNotes" rows="2" placeholder="Dietary restrictions, accessibility needs, etc." style="resize:vertical"></textarea>
        </div>
        <div class="divider"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closeTravModal()">Cancel</button>
          <button class="btn btn-primary" id="travSaveBtn" onclick="saveTraveller()">Add traveller</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeTravModal(); });
  }

  // Reset / pre-fill
  document.getElementById('travModalTitle').textContent = editing ? 'Edit Traveller' : 'Add Traveller';
  document.getElementById('travSaveBtn').textContent = editing ? 'Save changes' : 'Add traveller';
  document.getElementById('travSaveBtn').dataset.editId = editId || '';
  document.getElementById('travEmail').value = '';
  document.getElementById('travUserId').value = editing?.user_id || '';
  document.getElementById('travName').value = editing?.name || '';
  document.getElementById('travPhone').value = editing?.phone || '';
  document.getElementById('travEmergencyName').value = editing?.emergency_contact_name || '';
  document.getElementById('travEmergencyPhone').value = editing?.emergency_contact_phone || '';
  document.getElementById('travNotes').value = editing?.notes || '';
  document.getElementById('travLookupResult').textContent = '';
  // Hide email lookup when editing
  document.getElementById('travLookupSection').style.display = editing ? 'none' : 'block';

  modal.style.display = 'flex';
}
window.openAddTravellerModal = openAddTravellerModal;

window.openEditTraveller = function(id) { openAddTravellerModal(id); };

window.closeTravModal = function() {
  const m = document.getElementById('travModalOverlay');
  if (m) m.style.display = 'none';
};

window.lookupTraveller = async function() {
  const email = document.getElementById('travEmail').value.trim();
  const resultEl = document.getElementById('travLookupResult');
  if (!email) { resultEl.textContent = 'Enter an email to look up.'; return; }

  resultEl.textContent = 'Looking up…';
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, emergency_contact_name, emergency_contact_phone')
    .eq('email', email)
    .single();

  if (error || !data) {
    resultEl.style.color = 'var(--text-muted)';
    resultEl.textContent = 'No TripCollective account found — they will be added as a guest.';
    return;
  }

  // Pre-fill from their profile
  document.getElementById('travUserId').value = data.id;
  document.getElementById('travName').value = data.full_name || '';
  document.getElementById('travPhone').value = data.phone || '';
  document.getElementById('travEmergencyName').value = data.emergency_contact_name || '';
  document.getElementById('travEmergencyPhone').value = data.emergency_contact_phone || '';
  resultEl.style.color = '#2BA176';
  resultEl.textContent = `✓ Found: ${data.full_name || email} — details pre-filled from their profile.`;
};

window.saveTraveller = async function() {
  const saveBtn = document.getElementById('travSaveBtn');
  const editId = saveBtn.dataset.editId || null;

  const name = document.getElementById('travName').value.trim();
  if (!name) { alert('Name is required.'); return; }

  const payload = {
    trip_id: TRIP_ID,
    user_id: document.getElementById('travUserId').value || null,
    name,
    phone: document.getElementById('travPhone').value.trim() || null,
    emergency_contact_name: document.getElementById('travEmergencyName').value.trim() || null,
    emergency_contact_phone: document.getElementById('travEmergencyPhone').value.trim() || null,
    notes: document.getElementById('travNotes').value.trim() || null,
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  let error;
  if (editId) {
    const res = await supabase.from('travellers').update(payload).eq('id', editId);
    error = res.error;
    if (!error) {
      const idx = allTravellers.findIndex(t => t.id === editId);
      if (idx > -1) allTravellers[idx] = { ...allTravellers[idx], ...payload };
    }
  } else {
    const res = await supabase.from('travellers').insert(payload).select(`
      *,
      reservation_travellers ( reservation_id, reservations ( id, type, name, start_datetime, end_datetime ) )
    `).single();
    error = res.error;
    if (!error && res.data) allTravellers.push(res.data);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = editId ? 'Save changes' : 'Add traveller';

  if (error) {
    console.error('Traveller save error:', error);
    showToast('Could not save traveller: ' + error.message);
    return;
  }

  closeTravModal();
  renderTravellersList();
  showToast(editId ? 'Traveller updated!' : 'Traveller added!');
};

window.confirmDeleteTraveller = function(id) {
  if (!confirm('Remove this traveller from the trip?')) return;
  deleteTraveller(id);
};

async function deleteTraveller(id) {
  const { error } = await supabase.from('travellers').delete().eq('id', id);
  if (error) { showToast('Could not remove traveller.'); return; }
  allTravellers = allTravellers.filter(t => t.id !== id);
  renderTravellersList();
  showToast('Traveller removed.');
}

// ── NOTES & VOTES ──
// currentUserId already declared at top of module
let allVotes = [];       // raw rows from votes table
let voteTopics = {};     // grouped: { topicKey: { label, options: [{text, up, down, myVote}] } }

let allTripNotes = [];

async function renderNotes() {
  const el = document.getElementById('notes-content');
  if (!el) return;

  // Get current user
  const { data: { session } } = await supabase.auth.getSession();
  currentUserId = session?.user?.id || null;

  // Load votes + trip notes in parallel
  const [{ data: voteData }, { data: notesData }] = await Promise.all([
    supabase.from('votes').select('*').eq('trip_id', TRIP_ID).order('created_at', { ascending: true }),
    supabase.from('trip_notes').select('*').eq('trip_id', TRIP_ID).order('created_at', { ascending: true }),
  ]);

  allVotes = voteData || [];
  const rawNotes = notesData || [];

  // Fetch profiles for note authors separately (no direct FK from trip_notes to profiles)
  const authorIds = [...new Set(rawNotes.map(n => n.user_id).filter(Boolean))];
  let profileMap = {};
  if (authorIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', authorIds);
    (profileRows || []).forEach(p => { profileMap[p.id] = p; });
  }
  allTripNotes = rawNotes.map(n => ({
    ...n,
    profiles: profileMap[n.user_id] || null,
  }));

  buildVoteTopics();
  renderNotesList();
}

function buildVoteTopics() {
  voteTopics = {};
  allVotes.forEach(v => {
    const key = v.topic || 'general';
    if (!voteTopics[key]) voteTopics[key] = { label: v.topic || 'General', options: [], closed: false };
    const opt = v.option_text || '';
    if (!opt) return;
    // __closed__ is a sentinel row marking the vote as closed
    if (opt === '__closed__') { voteTopics[key].closed = (v.value === 1); return; }
    let existing = voteTopics[key].options.find(o => o.text === opt);
    if (!existing) {
      existing = { text: opt, up: 0, down: 0, myVote: null };
      voteTopics[key].options.push(existing);
    }
    // value=0 rows are definition rows — don't count as votes
    if (v.value > 0) existing.up++;
    if (v.value < 0) existing.down++;
    if (v.user_id === currentUserId && v.value !== 0) existing.myVote = v.value;
  });
}

function renderNotesList() {
  const el = document.getElementById('notes-content');
  if (!el) return;

  const topicKeys = Object.keys(voteTopics);

  // Build note cards HTML
  // Filter: show own notes always, show others' notes only if not private
  const visibleNotes = allTripNotes.filter(n =>
    n.user_id === currentUserId || !n.is_private
  );

  const noteCardsHtml = visibleNotes.map(n => {
    const name = n.profiles?.full_name || 'Traveller';
    const initials = name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    const avatarUrl = n.profiles?.avatar_url;
    const isOwn = n.user_id === currentUserId;
    const timeAgo = formatTimeAgo(n.created_at);
    const isPrivate = n.is_private;
    return `<div class="note-card ${isPrivate ? 'note-card-private' : ''}" data-note-id="${n.id}">
      <div class="note-card-header">
        <div class="note-card-title">${escapeHtml(n.title || 'Note')}</div>
        <div class="note-card-actions">
          ${isOwn ? `
            <button class="btn btn-icon" style="width:22px;height:22px;font-size:0.65rem"
                    onclick="editNote('${n.id}')" title="Edit">✏️</button>
            <button class="btn btn-icon" style="width:22px;height:22px;font-size:0.65rem"
                    onclick="deleteNote('${n.id}')" title="Delete">🗑</button>
          ` : ''}
          ${isOwn ? `
            <button class="note-privacy-dot ${isPrivate ? 'private' : 'shared'}"
                    onclick="toggleNotePrivacy('${n.id}', ${isPrivate})"
                    title="${isPrivate ? 'Private — click to share with group' : 'Shared — click to make private'}">
              <span class="privacy-dot-circle"></span>
              <span class="privacy-dot-label">${isPrivate ? 'Private' : 'Shared'}</span>
            </button>
          ` : ''}
          <div class="note-author-avatar" title="${escapeHtml(name)} · ${timeAgo}">
            ${avatarUrl
              ? `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
              : initials}
          </div>
        </div>
      </div>
      <div class="note-card-body">${escapeHtml(n.body || '')}</div>
    </div>`;
  }).join('');

  let html = `
  <div class="notes-layout">

    <!-- ── LEFT: Group Notes ── -->
    <div class="notes-col">
      <div class="notes-col-header" style="display:flex;align-items:center;justify-content:space-between">
        <div class="sp-section-title" style="margin:0">Group Notes</div>
        <button class="btn btn-primary btn-sm" onclick="openNoteModal()">+ Add note</button>
      </div>
      ${allTripNotes.length === 0
        ? `<div class="notes-empty">No notes yet — add a packing list, reminders, or anything the group needs to know.</div>`
        : noteCardsHtml}
    </div>

    <!-- ── RIGHT: Votes ── -->
    <div class="notes-col">
      <div class="notes-col-header" style="display:flex;align-items:center;justify-content:space-between">
        <div class="sp-section-title" style="margin:0">Votes</div>
        <button class="btn btn-primary btn-sm" onclick="openVoteModal()">+ New vote</button>
      </div>

      ${topicKeys.length === 0
        ? `<div class="notes-empty">No votes yet — propose something for the group to decide on!</div>`
        : topicKeys.map(key => {
            const t = voteTopics[key];
            const totalVoters = [...new Set(allVotes.filter(v => v.topic === key).map(v => v.user_id))].length;
            const isClosed = t.closed;
            // Find ALL tied winners when closed
            let winners = [];
            if (isClosed && t.options.length > 0) {
              const topScore = Math.max(...t.options.map(o => o.up - o.down));
              winners = t.options.filter(o => o.up - o.down === topScore && o.up > 0);
            }
            return `<div class="vote-card ${isClosed ? 'vote-card-closed' : ''}" data-topic="${escapeHtml(key)}">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
                <div>
                  <div class="vote-card-title">${escapeHtml(t.label)}</div>
                  ${isClosed ? `<div style="font-size:0.68rem;color:#2BA176;margin-top:2px">✓ Closed · ${totalVoters} vote${totalVoters!==1?'s':''} cast</div>` : ''}
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0">
                  <button class="btn btn-icon" style="width:26px;height:26px;font-size:0.68rem"
                          onclick="${isClosed ? `reopenVote('${escapeHtml(key)}')` : `closeVote('${escapeHtml(key)}')`}"
                          title="${isClosed ? 'Reopen vote' : 'Close vote'}">
                    ${isClosed ? '🔓' : '🔒'}
                  </button>
                  <button class="btn btn-icon" style="width:26px;height:26px;font-size:0.65rem"
                          onclick="confirmDeleteTopic('${escapeHtml(key)}')" title="Delete vote">🗑</button>
                </div>
              </div>
              ${winners.length > 0 ? `<div class="vote-winner">🏆 ${winners.map(w => `${escapeHtml(w.text)} <span style="color:var(--text-muted);font-weight:400">(${w.up} 👍 · ${w.down} 👎)</span>`).join(' &nbsp;·&nbsp; ')}</div>` : ''}
              ${isClosed ? '' : t.options.map(o => {
                const total = o.up + o.down;
                const pct = total > 0 ? Math.round((o.up / total) * 100) : 0;
                const myUp   = o.myVote === 1;
                const myDown = o.myVote === -1;
                return `<div class="vote-option-row">
                  <div class="vote-option-label">${escapeHtml(o.text)}</div>
                  <div class="vote-bar-wrap">
                    <div class="vote-bar" style="width:${pct}%"></div>
                  </div>
                  <div class="vote-tally">
                    <button class="vote-btn ${myUp ? 'voted-up' : ''}"
                            onclick="castVote('${escapeHtml(key)}','${escapeHtml(o.text)}',1)">👍</button>
                    <span class="vote-count">${o.up}</span>
                    <button class="vote-btn ${myDown ? 'voted-down' : ''}"
                            onclick="castVote('${escapeHtml(key)}','${escapeHtml(o.text)}',-1)">👎</button>
                    <span class="vote-count">${o.down}</span>
                  </div>
                </div>`;
              }).join('')}
              ${!isClosed ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:8px">${totalVoters} vote${totalVoters !== 1 ? 's' : ''} cast</div>` : ''}
            </div>`;
          }).join('')
      }
    </div>

  </div>`;

  el.innerHTML = html;

  // Restore notes
  if (tripData?.notes) {
    const area = document.getElementById('tripNotesArea');
    if (area) area.value = tripData.notes;
  }
}

// ── CAST VOTE ──
window.castVote = async function(topic, optionText, value) {
  if (!currentUserId) { showToast('Sign in to vote.'); return; }
  if (voteTopics[topic]?.closed) { showToast('This vote is closed.'); return; }

  // Toggle off if same vote already cast
  const existing = allVotes.find(v =>
    v.topic === topic && v.option_text === optionText && 
    v.user_id === currentUserId && v.value !== 0
  );

  if (existing) {
    if (existing.value === value) {
      // Remove vote (toggle off)
      await supabase.from('votes').delete().eq('id', existing.id);
      allVotes = allVotes.filter(v => v.id !== existing.id);
    } else {
      // Switch vote
      await supabase.from('votes').update({ value }).eq('id', existing.id);
      existing.value = value;
    }
  } else {
    const { data: newVote, error } = await supabase.from('votes').insert({
      trip_id: TRIP_ID,
      user_id: currentUserId,
      topic,
      option_text: optionText,
      value,
    }).select().single();
    if (!error && newVote) allVotes.push(newVote);
  }

  buildVoteTopics();
  // Re-render just the vote card for this topic (avoid full re-render which resets textarea)
  renderNotesList();
};

// ── DELETE VOTE TOPIC ──
window.confirmDeleteTopic = function(topic) {
  if (!confirm(`Delete the "${topic}" vote? All votes will be removed.`)) return;
  deleteTopic(topic);
};

async function deleteTopic(topic) {
  await supabase.from('votes').delete().eq('trip_id', TRIP_ID).eq('topic', topic);
  allVotes = allVotes.filter(v => v.topic !== topic);
  buildVoteTopics();
  renderNotesList();
  showToast('Vote deleted.');
}

// ── CLOSE / REOPEN VOTE ──
window.closeVote = async function(topic) {
  const t = voteTopics[topic];
  if (!t) return;

  // Check if all travellers have voted (count unique non-zero voters)
  const voters = [...new Set(
    allVotes.filter(v => v.topic === topic && v.value !== 0 && v.option_text !== '__closed__')
             .map(v => v.user_id)
  )];
  const totalTravellers = allTravellers.length || 1;
  const missing = totalTravellers - voters.length;

  if (missing > 0) {
    const proceed = confirm(
      `${missing} traveller${missing !== 1 ? 's have' : ' has'} not voted yet. Close the vote anyway?`
    );
    if (!proceed) return;
  }

  // Upsert a __closed__ sentinel row
  const existing = allVotes.find(v => v.topic === topic && v.option_text === '__closed__');
  if (existing) {
    await supabase.from('votes').update({ value: 1 }).eq('id', existing.id);
    existing.value = 1;
  } else {
    const { data: row, error } = await supabase.from('votes').insert({
      trip_id: TRIP_ID,
      user_id: currentUserId,
      topic,
      option_text: '__closed__',
      value: 1,
    }).select().single();
    if (error) { showToast('Could not close vote: ' + error.message); return; }
    if (row) allVotes.push(row);
  }

  buildVoteTopics();
  renderNotesList();
  showToast('Vote closed!');
};

window.reopenVote = async function(topic) {
  const existing = allVotes.find(v => v.topic === topic && v.option_text === '__closed__');
  if (existing) {
    await supabase.from('votes').update({ value: 0 }).eq('id', existing.id);
    existing.value = 0;
  }
  buildVoteTopics();
  renderNotesList();
  showToast('Vote reopened.');
};

// ── NEW VOTE MODAL ──
window.openVoteModal = function() {
  let modal = document.getElementById('voteModalOverlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'voteModalOverlay';
    modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(44,32,56,0.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:20px;width:100%;max-width:460px;padding:24px;box-shadow:0 20px 60px rgba(44,32,56,0.2);max-height:90vh;overflow-y:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h2 style="font-family:var(--font-display);font-size:1.2rem;font-weight:600">New Vote</h2>
          <button class="btn btn-icon" onclick="closeVoteModal()">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Question *</label>
          <input class="form-input" type="text" id="voteQuestion"
                 placeholder="e.g. Where should we eat on New Year's Eve?">
        </div>
        <div class="form-group">
          <label class="form-label">Options *</label>
          <div id="voteOptions">
            <div class="vote-option-input-row">
              <input class="form-input" type="text" placeholder="Option 1" style="margin-bottom:6px">
            </div>
            <div class="vote-option-input-row">
              <input class="form-input" type="text" placeholder="Option 2" style="margin-bottom:6px">
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="addVoteOption()">+ Add option</button>
        </div>
        <div class="divider"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closeVoteModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveVoteTopic()">Create vote</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeVoteModal(); });
  }

  // Reset
  document.getElementById('voteQuestion').value = '';
  document.getElementById('voteOptions').innerHTML = `
    <div class="vote-option-input-row"><input class="form-input" type="text" placeholder="Option 1" style="margin-bottom:6px"></div>
    <div class="vote-option-input-row"><input class="form-input" type="text" placeholder="Option 2" style="margin-bottom:6px"></div>`;
  modal.style.display = 'flex';
};

window.closeVoteModal = function() {
  const m = document.getElementById('voteModalOverlay');
  if (m) m.style.display = 'none';
};

window.addVoteOption = function() {
  const container = document.getElementById('voteOptions');
  const count = container.querySelectorAll('input').length + 1;
  const row = document.createElement('div');
  row.className = 'vote-option-input-row';
  row.innerHTML = `<input class="form-input" type="text" placeholder="Option ${count}" style="margin-bottom:6px">`;
  container.appendChild(row);
};

window.saveVoteTopic = async function() {
  const question = document.getElementById('voteQuestion').value.trim();
  if (!question) { alert('Please enter a question.'); return; }

  const options = [...document.querySelectorAll('#voteOptions input')]
    .map(i => i.value.trim()).filter(Boolean);
  if (options.length < 2) { alert('Please enter at least 2 options.'); return; }

  // Check for duplicate topic
  if (voteTopics[question]) { alert('A vote with this question already exists.'); return; }

  // Store vote topic + options in trip metadata (votes table rows need a user)
  // We store one "definition" row per option using the current user as creator
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) { showToast('Sign in to create a vote.'); return; }

  const inserts = options.map(opt => ({
    trip_id: TRIP_ID,
    user_id: uid,
    topic: question,
    option_text: opt,
    value: 0,  // 0 = definition row, not a real vote
  }));

  const { data, error } = await supabase.from('votes').insert(inserts).select();
  if (error) { showToast('Could not create vote: ' + error.message); console.error(error); return; }

  allVotes.push(...(data || []));
  buildVoteTopics();
  closeVoteModal();
  renderNotesList();
  showToast('Vote created!');
};

// ── NOTE CRUD ──
window.openNoteModal = function(editId) {
  const editing = editId ? allTripNotes.find(n => n.id === editId) : null;
  let modal = document.getElementById('noteModalOverlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'noteModalOverlay';
    modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(44,32,56,0.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:20px;width:100%;max-width:460px;padding:24px;box-shadow:0 20px 60px rgba(44,32,56,0.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h2 style="font-family:var(--font-display);font-size:1.2rem;font-weight:600" id="noteModalTitle">Add Note</h2>
          <button class="btn btn-icon" onclick="closeNoteModal()">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Title</label>
          <input class="form-input" type="text" id="noteTitle" placeholder="e.g. Packing list, Reminders, Ideas…">
        </div>
        <div class="form-group">
          <label class="form-label">Note</label>
          <textarea class="form-input" id="noteBody" rows="5" style="resize:vertical"
                    placeholder="Add your note here…"></textarea>
        </div>
        <div class="divider"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closeNoteModal()">Cancel</button>
          <button class="btn btn-primary" id="noteSaveBtn" onclick="saveNote()">Add note</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeNoteModal(); });
  }
  document.getElementById('noteModalTitle').textContent = editing ? 'Edit Note' : 'Add Note';
  document.getElementById('noteSaveBtn').textContent = editing ? 'Save changes' : 'Add note';
  document.getElementById('noteSaveBtn').dataset.editId = editId || '';
  document.getElementById('noteTitle').value = editing?.title || '';
  document.getElementById('noteBody').value = editing?.body || '';
  modal.style.display = 'flex';
};

window.closeNoteModal = function() {
  const m = document.getElementById('noteModalOverlay');
  if (m) m.style.display = 'none';
};

window.editNote = function(id) { openNoteModal(id); };

window.saveNote = async function() {
  const editId = document.getElementById('noteSaveBtn').dataset.editId || null;
  const title = document.getElementById('noteTitle').value.trim() || 'Note';
  const body = document.getElementById('noteBody').value.trim();
  if (!body) { alert('Please enter a note.'); return; }

  const saveBtn = document.getElementById('noteSaveBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  let error;
  if (editId) {
    const res = await supabase.from('trip_notes')
      .update({ title, body, updated_at: new Date().toISOString() }).eq('id', editId);
    error = res.error;
    if (!error) {
      const idx = allTripNotes.findIndex(n => n.id === editId);
      if (idx > -1) { allTripNotes[idx].title = title; allTripNotes[idx].body = body; }
    }
  } else {
    const res = await supabase.from('trip_notes')
      .insert({ trip_id: TRIP_ID, user_id: currentUserId, title, body })
      .select('*').single();
    error = res.error;
    if (!error && res.data) {
      // Attach current user's profile to the new note for immediate display
      const { data: myProfile } = await supabase
        .from('profiles').select('id, full_name, avatar_url')
        .eq('id', currentUserId).single();
      allTripNotes.push({ ...res.data, profiles: myProfile || null });
    }
  }

  saveBtn.disabled = false; saveBtn.textContent = editId ? 'Save changes' : 'Add note';
  if (error) { showToast('Could not save note: ' + error.message); return; }
  closeNoteModal();
  renderNotesList();
  showToast(editId ? 'Note updated!' : 'Note added!');
};

window.deleteNote = async function(id) {
  if (!confirm('Delete this note?')) return;
  const { error } = await supabase.from('trip_notes').delete().eq('id', id);
  if (error) { showToast('Could not delete note.'); return; }
  allTripNotes = allTripNotes.filter(n => n.id !== id);
  renderNotesList();
  showToast('Note deleted.');
};

window.toggleNotePrivacy = async function(id, currentlyPrivate) {
  const newVal = !currentlyPrivate;
  const { error } = await supabase
    .from('trip_notes').update({ is_private: newVal }).eq('id', id);
  if (error) { showToast('Could not update note.'); return; }
  const note = allTripNotes.find(n => n.id === id);
  if (note) note.is_private = newVal;
  renderNotesList();
  showToast(newVal ? 'Note is now private.' : 'Note is now shared with the group.');
};

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
// ── TRIP INTEL (Claude API via Netlify proxy) ──
// Cache key: per trip + destination so refreshes are cheap
function intelCacheKey() {
  return `tc_intel_${TRIP_ID}_${(tripData?.destination || '').replace(/\s+/g,'_')}`;
}

window.renderTripIntel = async function renderTripIntel(forceRefresh = false) {
  const el = document.getElementById('intel-panel');
  if (!el) return;

  const destination = tripData?.destination || 'your destination';

  // Check localStorage cache first (skip if forcing refresh)
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(intelCacheKey());
      if (cached) {
        const { intel, ts } = JSON.parse(cached);
        // Cache valid for 7 days — intel doesn't change often
        if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) {
          renderIntelContent(el, destination, intel);
          return;
        }
      }
    } catch(e) {}
  }

  el.innerHTML = `<div class="intel-loading">
    <div class="intel-spinner"></div>
    <div class="intel-spinner-label">Asking Claude about ${escapeHtml(destination)}…</div>
  </div>`;

  const prompt = `You are a travel intelligence assistant. For a trip to ${destination}, provide travel intel as a JSON object ONLY — no markdown, no preamble, just the raw JSON object:
{"esim":[{"name":"string","detail":"string"}],"transit":["string"],"rideshare":["string"],"tipping":"string","delicacies":["string"],"phrases":[{"en":"string","local":"string"}]}
esim: 2-3 eSIM providers with price/data. transit: 3-4 practical tips. rideshare: 2 tips. tipping: 1 sentence. delicacies: 5-6 must-try foods. phrases: 6 useful local phrases (English meaning first). Keep all strings under 20 words.`;

  try {
    // Try Netlify proxy first (works in production + local with netlify dev)
    let raw = '';
    let usedProxy = false;

    try {
      const proxyRes = await fetch('/.netlify/functions/claude-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (proxyRes.ok) {
        const proxyText = await proxyRes.text();
        try {
          const proxyData = JSON.parse(proxyText);
          raw = proxyData.text || '';
          if (raw) usedProxy = true;
        } catch(e) {
          console.warn('Proxy returned non-JSON:', proxyText.slice(0, 200));
        }
      } else {
        const errText = await proxyRes.text();
        console.warn('Proxy error response:', proxyRes.status, errText.slice(0, 200));
      }
    } catch(proxyErr) {
      console.warn('Proxy not available, trying direct:', proxyErr.message);
    }

    // Fallback: direct call (works locally if CORS not an issue, blocked in production)
    if (!usedProxy) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      raw = data.content?.find(b => b.type === 'text')?.text || '';
    }

    const clean = raw.replace(/```json|```/g, '').trim();
    const intel = JSON.parse(clean);

    // Cache to localStorage
    try {
      localStorage.setItem(intelCacheKey(), JSON.stringify({ intel, ts: Date.now() }));
    } catch(e) {}

    renderIntelContent(el, destination, intel);
  } catch(e) {
    console.error('Trip Intel error:', e);
    el.innerHTML = `<div class="intel-error">
      <div style="font-size:1.5rem;margin-bottom:8px">⚠️</div>
      Could not load Trip Intel. Check your connection.<br>
      <button class="intel-refresh-btn" style="margin-top:12px"
              onclick="intelLoaded=false;renderTripIntel(true)">Try again</button>
    </div>`;
  }
}

function renderIntelContent(el, destination, d) {
  el.innerHTML = `
    <div class="intel-dest-header">
      <div class="intel-dest-name">${escapeHtml(destination)}</div>
      <button class="intel-refresh-btn" onclick="intelLoaded=false;renderTripIntel(true)">↻ Refresh</button>
    </div>

    ${d.esim?.length ? `
    <div class="intel-section">
      <div class="intel-section-title">📱 eSIM options</div>
      ${d.esim.map(e => `<div class="intel-esim"><div class="intel-esim-name">${escapeHtml(e.name)}</div><div class="intel-esim-detail">${escapeHtml(e.detail)}</div></div>`).join('')}
    </div>` : ''}

    ${d.transit?.length ? `
    <div class="intel-section">
      <div class="intel-section-title">🚇 Transit tips</div>
      ${d.transit.map(t => `<div class="intel-row"><span>${escapeHtml(t)}</span></div>`).join('')}
    </div>` : ''}

    ${d.rideshare?.length ? `
    <div class="intel-section">
      <div class="intel-section-title">🚗 Rideshare</div>
      ${d.rideshare.map(t => `<div class="intel-row"><span>${escapeHtml(t)}</span></div>`).join('')}
    </div>` : ''}

    ${d.tipping ? `
    <div class="intel-section">
      <div class="intel-section-title">💵 Tipping culture</div>
      <div class="intel-row"><span>${escapeHtml(d.tipping)}</span></div>
    </div>` : ''}

    ${d.delicacies?.length ? `
    <div class="intel-section">
      <div class="intel-section-title">🍽 Local delicacies</div>
      <div class="intel-chips">${d.delicacies.map(x => `<span class="intel-chip">${escapeHtml(x)}</span>`).join('')}</div>
    </div>` : ''}

    ${d.phrases?.length ? `
    <div class="intel-section">
      <div class="intel-section-title">💬 Key phrases</div>
      ${d.phrases.map(p => `<div class="intel-phrase"><span class="intel-phrase-en">${escapeHtml(p.en)}</span><span class="intel-phrase-local">${escapeHtml(p.local)}</span></div>`).join('')}
    </div>` : ''}
  `;
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
