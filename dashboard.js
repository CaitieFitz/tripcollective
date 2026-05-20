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
      cover_image_position,
      status,
      visibility,
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
      <div style="grid-column:1/-1; text-align:center; padding:3rem 1rem;">
        <p style="color:var(--text-muted,#888); font-size:1rem; margin-bottom:1rem;">No trips yet — let's plan your first adventure!</p>
        <button class="btn btn-primary" onclick="openNewTripModal()">+ New Trip</button>
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
    const hasCover = !!cover;
    const bgPos = trip.cover_image_position || '50% 50%';

    return `
      <div class="card trip-card" style="position:relative; overflow:hidden; padding:0;">

        <!-- Cover photo area -->
        <div class="trip-card-cover"
             id="cover-${trip.id}"
             style="
               height: 160px;
               background: ${hasCover
                 ? `url('${cover}') ${bgPos}/cover no-repeat`
                 : 'linear-gradient(135deg, #E8856A22, #A89FC844)'};
               position: relative;
               display: flex;
               align-items: flex-end;
               justify-content: flex-end;
               padding: 10px;
             "
             data-bg-pos="${bgPos}">

          <!-- Status badge top-left -->
          <span class="badge badge-${statusLabel.toLowerCase()}"
                style="position:absolute; top:10px; left:10px;">
            <span class="badge-dot"></span>${statusLabel}
          </span>

          <!-- Camera upload button -->
          <label for="photo-${trip.id}"
                 title="Add cover photo"
                 style="
                   width: 32px; height: 32px;
                   background: rgba(0,0,0,0.45);
                   border-radius: 50%;
                   display: flex; align-items: center; justify-content: center;
                   cursor: pointer; font-size: 0.9rem;
                   transition: background 0.2s;
                   flex-shrink: 0;
                 "
                 onmouseover="this.style.background='rgba(0,0,0,0.7)'"
                 onmouseout="this.style.background='rgba(0,0,0,0.45)'"
                 onclick="event.stopPropagation()">
            📷
          </label>
          <input type="file"
                 id="photo-${trip.id}"
                 accept="image/jpeg,image/png,image/webp"
                 style="display:none"
                 onchange="uploadTripCover('${trip.id}', this)"
                 onclick="event.stopPropagation()">

          <!-- Reposition button — only shown when cover exists -->
          ${hasCover ? `
          <button title="Drag to reposition photo"
                  style="
                    width: 32px; height: 32px;
                    background: rgba(0,0,0,0.45);
                    border: none;
                    border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    cursor: grab; font-size: 0.9rem;
                    margin-left: 6px;
                    transition: background 0.2s;
                    flex-shrink: 0;
                  "
                  onmouseover="this.style.background='rgba(0,0,0,0.7)'"
                  onmouseout="this.style.background='rgba(0,0,0,0.45)'"
                  onmousedown="startReposition(event, '${trip.id}')"
                  onclick="event.stopPropagation()">
            ✥
          </button>` : ''}
        </div>

        <!-- Card body — clickable to open trip -->
        <a href="trip-planner.html?id=${trip.id}"
           class="card-body"
           style="text-decoration:none; display:block; color:inherit; padding:16px;">
          <div class="trip-card-badges" style="margin-bottom:8px;">
            <span class="badge-visibility">
              ${trip.visibility === 'public' ? '👁 Public' : '🔒 Private'}
            </span>
          </div>
          <div class="trip-card-name">${escapeHtml(trip.name)}</div>
          <div class="trip-card-meta" style="margin-top:6px;">
            ${trip.destination
              ? `<div class="trip-card-meta-row"><span>📍</span> ${escapeHtml(trip.destination)}</div>`
              : ''}
            <div class="trip-card-meta-row"><span>📅</span> ${dateRange}</div>
          </div>
        </a>

      </div>
    `;
  }).join('');
}

// ============================================================
// TRIP COVER PHOTO UPLOAD
// ============================================================
async function uploadTripCover(tripId, input) {
  const file = input.files[0];
  if (!file) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  // Show loading state on camera button
  const label = input.previousElementSibling;
  if (label) label.textContent = '⏳';

  const ext = file.name.split('.').pop();
  const path = `${session.user.id}/${tripId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('trip-covers')
    .upload(path, file, { upsert: true });

  if (uploadError) {
    console.error('Upload failed:', uploadError.message);
    if (label) label.textContent = '📷';
    showToast('Upload failed. Please try again.', 'error');
    return;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('trip-covers')
    .getPublicUrl(path);

  // Save URL to trips table
  const { error: updateError } = await supabase
    .from('trips')
    .update({ cover_image: publicUrl })
    .eq('id', tripId);

  if (updateError) {
    console.error('Could not save cover URL:', updateError.message);
    if (label) label.textContent = '📷';
    showToast('Photo uploaded but could not save. Try again.', 'error');
    return;
  }

  // Update the card cover immediately without reloading
  const coverEl = document.getElementById(`cover-${tripId}`);
  if (coverEl) {
    coverEl.style.background = `url('${publicUrl}') center/cover no-repeat`;
  }
  if (label) label.textContent = '📷';
  showToast('Cover photo updated!', 'success');
}

// ============================================================
// DRAG TO REPOSITION COVER PHOTO
// ============================================================
let repoState = null;

function startReposition(e, tripId) {
  e.preventDefault();
  e.stopPropagation();

  const coverEl = document.getElementById(`cover-${tripId}`);
  if (!coverEl) return;

  // Parse current background-position (default 50% 50%)
  const style = window.getComputedStyle(coverEl);
  const pos = coverEl.dataset.bgPos || '50% 50%';
  let [xPct, yPct] = pos.split(' ').map(p => parseFloat(p));

  repoState = { tripId, coverEl, startX: e.clientX, startY: e.clientY, xPct, yPct };

  coverEl.style.cursor = 'grabbing';
  document.addEventListener('mousemove', onRepoMove);
  document.addEventListener('mouseup', onRepoEnd);
}

function onRepoMove(e) {
  if (!repoState) return;
  const { coverEl, startX, startY } = repoState;

  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  // Each pixel of drag = ~0.3% position shift (tune as needed)
  let newX = Math.max(0, Math.min(100, repoState.xPct - dx * 0.3));
  let newY = Math.max(0, Math.min(100, repoState.yPct - dy * 0.3));

  coverEl.style.backgroundPosition = `${newX}% ${newY}%`;
  coverEl.dataset.bgPos = `${newX}% ${newY}%`;
}

async function onRepoEnd(e) {
  if (!repoState) return;

  const { tripId, coverEl } = repoState;
  coverEl.style.cursor = 'default';
  document.removeEventListener('mousemove', onRepoMove);
  document.removeEventListener('mouseup', onRepoEnd);

  const pos = coverEl.dataset.bgPos || '50% 50%';

  // Save position to DB
  const { error } = await supabase
    .from('trips')
    .update({ cover_image_position: pos })
    .eq('id', tripId);

  if (!error) {
    showToast('Position saved!', 'success');
  }

  repoState = null;
}
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.tc-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'tc-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
    background: ${type === 'success' ? '#E8856A' : '#E24B4A'};
    color: #fff; padding: .75rem 1.25rem; border-radius: 8px;
    font-family: 'DM Sans', sans-serif; font-size: .875rem;
    box-shadow: 0 4px 12px rgba(0,0,0,.15);
    transition: opacity .3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
window.uploadTripCover = uploadTripCover;
window.startReposition = startReposition;
