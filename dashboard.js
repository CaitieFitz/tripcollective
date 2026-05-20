// ============================================================
// TripCollective — Dashboard Data Layer
// dashboard.js — drop this script tag into dashboard.html
// Handles: real trip data, New Trip modal save, user nav avatar
// ============================================================

import { supabase } from './supabase.js';

// ============================================================
// AUTH GUARD — redirect if not logged in
// ============================================================
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

// ============================================================
// PULL REAL USER NAME INTO NAV AVATAR
// ============================================================
async function loadUserProfile(userId) {
  const { data: profiles, error } = await supabase
  .from('profiles')
  .select('full_name, avatar_url')
  .eq('id', userId)
  .limit(1);

if (error || !profiles?.length) {
  console.warn('Could not load profile:', error?.message);
  return;
}

const profile = profiles[0];

  const name = profile?.full_name || 'Traveler';
  const avatarUrl = profile?.avatar_url;

  // Update nav avatar initials
  const initials = name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const avatarEl = document.querySelector('[data-nav-avatar]');
  const avatarNameEl = document.querySelector('[data-nav-name]');

  if (avatarEl) {
    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${avatarUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      avatarEl.textContent = initials;
    }
  }

  if (avatarNameEl) {
    avatarNameEl.textContent = name.split(' ')[0]; // first name only
  }

  // Also update any greeting on page
  const greetingEl = document.querySelector('[data-greeting]');
  if (greetingEl) {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    greetingEl.textContent = `${timeGreeting}, ${name.split(' ')[0]}`;
  }
}

// ============================================================
// LOAD TRIPS
// ============================================================
async function loadTrips(userId) {
  const { data: trips, error } = await supabase
    .from('trips')
    .select(`
      id,
      name,
      destination,
      start_date,
      end_date,
      cover_image,
      status,
      created_at
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading trips:', error.message);
    showTripsError();
    return;
  }

  renderTrips(trips || []);
  updateTripStats(trips || []);
}

function updateTripStats(trips) {
  const total = trips.length;
  const upcoming = trips.filter(t => t.status === 'upcoming' || (t.start_date && new Date(t.start_date) > new Date())).length;
  const past = trips.filter(t => t.status === 'completed' || (t.end_date && new Date(t.end_date) < new Date())).length;

  const setEl = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = val;
  };

  setEl('[data-stat-total]', total);
  setEl('[data-stat-upcoming]', upcoming);
  setEl('[data-stat-past]', past);
}

function renderTrips(trips) {
  const container = document.querySelector('[data-trips-grid]');
  if (!container) return;

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="trips-empty" style="grid-column: 1/-1; text-align:center; padding: 3rem 1rem;">
        <p style="color: var(--text-muted, #888); font-size: 1rem; margin-bottom: 1rem;">No trips yet — let's plan your first adventure!</p>
        <button class="btn-primary" onclick="openNewTripModal()">+ New Trip</button>
      </div>
    `;
    return;
  }

  container.innerHTML = trips.map(trip => {
    const start = trip.start_date ? formatDate(trip.start_date) : null;
    const end = trip.end_date ? formatDate(trip.end_date) : null;
    const dateRange = start && end ? `${start} – ${end}` : start || 'Dates TBD';
    const statusLabel = getTripStatus(trip);
    const cover = trip.cover_image || '';

    return `
      <a href="/trip-planner.html?id=${trip.id}" class="trip-card" style="text-decoration:none; display:block;">
        <div class="trip-card__cover" style="background: ${cover ? `url('${cover}') center/cover` : 'linear-gradient(135deg, #E8856A22, #A89FC844)'};">
          <span class="trip-card__status trip-card__status--${statusLabel.toLowerCase()}">${statusLabel}</span>
        </div>
        <div class="trip-card__body">
          <h3 class="trip-card__title">${escapeHtml(trip.name)}</h3>
          ${trip.destination ? `<p class="trip-card__destination">📍 ${escapeHtml(trip.destination)}</p>` : ''}
          <p class="trip-card__dates">${dateRange}</p>
        </div>
      </a>
    `;
  }).join('');
}

function getTripStatus(trip) {
  if (trip.status) return capitalize(trip.status);
  const now = new Date();
  if (trip.start_date && new Date(trip.start_date) > now) return 'Upcoming';
  if (trip.end_date && new Date(trip.end_date) < now) return 'Past';
  return 'Planning';
}

function showTripsError() {
  const container = document.querySelector('[data-trips-grid]');
  if (container) {
    container.innerHTML = `<p style="color: var(--color-danger, #E24B4A); padding: 1rem;">Failed to load trips. Please refresh.</p>`;
  }
}

// ============================================================
// NEW TRIP MODAL
// ============================================================
function openNewTripModal() {
  const modal = document.querySelector('[data-new-trip-modal]');
  if (modal) modal.style.display = 'flex';
}

function closeNewTripModal() {
  const modal = document.querySelector('[data-new-trip-modal]');
  if (modal) {
    modal.style.display = 'none';
    document.querySelector('[data-new-trip-form]')?.reset();
    clearFormError();
  }
}

function showFormError(msg) {
  const el = document.querySelector('[data-trip-form-error]');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearFormError() {
  const el = document.querySelector('[data-trip-form-error]');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

async function saveNewTrip(e) {
  e.preventDefault();
  clearFormError();

  const form = e.target;
  const submitBtn = form.querySelector('[data-submit-btn]');
  if (submitBtn) submitBtn.disabled = true;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/login.html'; return; }

  const title = form.querySelector('[name="title"]')?.value?.trim();
  const destination = form.querySelector('[name="destination"]')?.value?.trim();
  const startDate = form.querySelector('[name="start_date"]')?.value || null;
  const endDate = form.querySelector('[name="end_date"]')?.value || null;
  const notes = form.querySelector('[name="notes"]')?.value?.trim() || null;

  if (!title) {
    showFormError('Trip name is required.');
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  const { data: newTrip, error } = await supabase
    .from('trips')
    .insert({
      user_id: session.user.id,
      name: title,
      destination: destination || null,
      start_date: startDate,
      end_date: endDate,
      status: 'planning',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Insert error:', error);
    showFormError('Could not save trip. Please try again.');
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  closeNewTripModal();
  // Redirect to the new trip's planner page
  window.location.href = `/trip-planner.html?id=${newTrip.id}`;
}

// ============================================================
// SIGN OUT
// ============================================================
async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
}

// ============================================================
// UTILITIES
// ============================================================
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  const userId = session.user.id;

  await Promise.all([
    loadUserProfile(userId),
    loadTrips(userId),
  ]);

  // Wire up New Trip modal form
  const newTripForm = document.querySelector('[data-new-trip-form]');
  if (newTripForm) newTripForm.addEventListener('submit', saveNewTrip);

  // Wire up New Trip button(s)
  document.querySelectorAll('[data-open-new-trip]').forEach(btn => {
    btn.addEventListener('click', openNewTripModal);
  });

  // Wire up modal close
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeNewTripModal);
  });

  // Close modal on backdrop click
  const modal = document.querySelector('[data-new-trip-modal]');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeNewTripModal();
    });
  }

  // Wire up sign out
  document.querySelectorAll('[data-sign-out]').forEach(btn => {
    btn.addEventListener('click', signOut);
  });
});

// Expose for inline onclick fallbacks
window.openNewTripModal = openNewTripModal;
window.closeNewTripModal = closeNewTripModal;
window.signOut = signOut;
