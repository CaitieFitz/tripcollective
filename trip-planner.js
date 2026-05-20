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

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  if (!TRIP_ID) { window.location.href = 'dashboard.html'; return; }

  await Promise.all([
    loadTrip(session.user.id),
    loadActivities(),
  ]);

  wireAddActivityForm(session.user.id);
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
  renderCurrentDay();
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
  renderCurrentDay();
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
  // Find the card-view day section and replace its content
  const cardView = document.getElementById('card-view');
  if (!cardView) return;

  const dateLabel = activities[0]?.activity_date
    ? formatFullDate(activities[0].activity_date)
    : `Day ${currentDay}`;

  const locationLabel = activities[0]?.location
    ? activities[0].location.split(',').slice(-2).join(',').trim()
    : tripData?.destination || '';

  cardView.innerHTML = `
    <div class="day-section active">
      <div class="day-section-header">
        <div class="day-section-num">0${currentDay}</div>
        <div>
          <div class="day-section-date">${dateLabel}</div>
          <div class="day-section-location">${locationLabel} · ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} planned</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto"
                onclick="openActivityModal()">+ Add</button>
      </div>

      ${activities.length === 0
        ? `<div style="text-align:center;padding:2rem;color:var(--text-muted)">
             No activities yet for this day.
           </div>`
        : activities.map(a => renderActivityCard(a)).join('')
      }

      <button class="card-add-activity" onclick="openActivityModal()">
        + Add activity to Day ${currentDay}
      </button>
    </div>
  `;
}

function renderActivityCard(a) {
  const categoryConfig = getCategoryConfig(a.category);
  const timeStr = a.start_time ? formatTime(a.start_time) : '';
  const duration = a.duration_minutes ? formatDuration(a.duration_minutes) : '';

  return `
    <div class="activity-card" data-activity-id="${a.id}">
      <div class="activity-card-time">${timeStr}</div>
      <div class="activity-card-bar" style="background:${categoryConfig.color}"></div>
      <div class="activity-card-content">
        <div class="activity-card-top">
          <div class="activity-card-name">${escapeHtml(a.name)}</div>
          <button class="activity-card-menu" onclick="openActivityOptions('${a.id}')">···</button>
        </div>
        <div class="activity-card-meta">
          <span class="activity-cat cat-${a.category || 'other'}">
            ${categoryConfig.icon} ${categoryConfig.label}
            ${duration ? `· ${duration}` : ''}
          </span>
          ${a.source ? `<span class="activity-source-pill">${escapeHtml(a.source)}</span>` : ''}
        </div>
        ${a.location ? `<div class="activity-card-location">📍 ${escapeHtml(a.location)}</div>` : ''}
        ${a.personal_note ? `<div class="activity-card-note">${escapeHtml(a.personal_note)}</div>` : ''}
        ${a.tip ? `<div class="activity-card-tip">💡 ${escapeHtml(a.tip)}</div>` : ''}
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
window.buildGrid = function() {
  const body = document.getElementById('gridBody');
  if (!body) return;

  // Get days shown in nav
  const days = [...new Set(allActivities.map(a => a.day_number))].sort((a,b) => a-b);
  if (days.length === 0) { body.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">No activities yet.</p>'; return; }

  // Build time → activity lookup per day
  const byDay = {};
  days.forEach(d => { byDay[d] = {}; });
  allActivities.forEach(a => {
    if (!a.start_time) return;
    const slot = timeToSlot(a.start_time);
    if (slot && byDay[a.day_number]) {
      byDay[a.day_number][slot] = a;
    }
  });

  // Update grid header columns
  const gridHeader = document.querySelector('.grid-header');
  if (gridHeader) {
    gridHeader.innerHTML = `<div class="grid-header-time"></div>` +
      days.map(d => {
        const acts = allActivities.filter(a => a.day_number === d);
        const dateStr = acts[0]?.activity_date ? formatDayLabel(acts[0].activity_date) : '';
        return `<div class="grid-header-day"><span>Day ${d}</span><small>${dateStr}</small></div>`;
      }).join('');
  }

  body.innerHTML = '';
  TIME_SLOTS.forEach(slot => {
    const row = document.createElement('div');
    row.className = 'grid-row';
    let html = `<div class="grid-time-cell">${slot}</div>`;
    days.forEach(d => {
      const a = byDay[d]?.[slot];
      if (a) {
        const cfg = getCategoryConfig(a.category);
        html += `<div class="grid-cell">
          <div class="grid-activity cat-${a.category || 'other'}" onclick="openActivityModal()">
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
// ACTIVITY OPTIONS (delete)
// ============================================================
window.openActivityOptions = function(activityId) {
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
