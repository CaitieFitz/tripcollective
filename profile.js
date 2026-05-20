// ============================================================
// TripCollective — Profile Page Data Layer
// profile.js — drop this script tag into profile.html
// ============================================================

import { supabase } from './supabase.js';

// Detect if viewing own profile or someone else's
// Usage: /profile.html (own) or /profile.html?id=uuid (other user)
const params = new URLSearchParams(window.location.search);
const targetUserId = params.get('id'); // null = own profile

let currentUserId = null;
let isOwnProfile = false;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session && !targetUserId) {
    // Own profile but not logged in → redirect
    window.location.href = '/login.html';
    return;
  }

  currentUserId = session?.user?.id || null;
  const profileId = targetUserId || currentUserId;
  isOwnProfile = profileId === currentUserId;

  await Promise.all([
    loadProfile(profileId),
    loadPublicTrips(profileId),
    loadPublishedGuides(profileId),
    loadTripStats(profileId),
  ]);

  if (isOwnProfile) {
    showEditControls();
    wireEditForm();
    wireAvatarUpload(profileId);
  }

  // Sign out wiring
  document.querySelectorAll('[data-sign-out]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/login.html';
    });
  });
});

// ============================================================
// LOAD PROFILE
// ============================================================
async function loadProfile(userId) {
const { data: profiles, error } = await supabase
  .from('profiles')
  .select('full_name, avatar_url, bio, location, created_at')
  .eq('id', userId)
  .limit(1);

if (error || !profiles?.length) {
  console.warn('Profile not found:', error?.message);
  return;
}

const profile = profiles[0];
  }

  setEl('[data-profile-name]', profile.full_name || 'Traveler');
  setEl('[data-profile-bio]', profile.bio || (isOwnProfile ? 'Add a bio to tell the community about yourself.' : ''));
  setEl('[data-profile-location]', profile.location || '');
  setEl('[data-profile-joined]', `Member since ${formatDate(profile.created_at, true)}`);

  // Avatar
  const avatarEl = document.querySelector('[data-profile-avatar]');
  if (avatarEl) {
    const name = profile.full_name || 'T';
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    if (profile.avatar_url) {
      avatarEl.innerHTML = `<img src="${profile.avatar_url}" alt="${escapeHtml(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      avatarEl.textContent = initials;
    }
  }

  // Pre-fill edit form if own profile
  if (isOwnProfile) {
    setInputVal('[data-edit-name]', profile.full_name || '');
    setInputVal('[data-edit-bio]', profile.bio || '');
    setInputVal('[data-edit-location]', profile.location || '');
  }
}

// ============================================================
// TRIP STATS
// ============================================================
async function loadTripStats(userId) {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, status, end_date')
    .eq('user_id', userId);

  if (error) return;

  const total = trips.length;
  const completed = trips.filter(t =>
    t.status === 'completed' || (t.end_date && new Date(t.end_date) < new Date())
  ).length;

  setEl('[data-stat-trips]', total);
  setEl('[data-stat-completed]', completed);
}

// ============================================================
// PUBLIC TRIPS
// ============================================================
async function loadPublicTrips(userId) {
  const query = supabase
    .from('trips')
    .select('id, name, destination, start_date, end_date, cover_image, status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(6);

  // If not own profile, only show non-private trips
  // (add a `is_private` column to trips if you want fine-grained control)
  const { data: trips, error } = await query;

  if (error) { console.warn('Trips load error:', error.message); return; }

  const container = document.querySelector('[data-profile-trips]');
  if (!container) return;

  if (!trips || trips.length === 0) {
    container.innerHTML = `<p class="empty-state">${isOwnProfile ? 'No trips yet.' : 'No public trips.'}</p>`;
    return;
  }

  container.innerHTML = trips.map(trip => {
    const cover = trip.cover_image || '';
    const start = trip.start_date ? formatDate(trip.start_date) : 'TBD';
    return `
      <a href="/trip-planner.html?id=${trip.id}" class="profile-trip-card" style="text-decoration:none;">
        <div class="profile-trip-card__cover" style="background:${cover ? `url('${cover}') center/cover` : '#E8856A22'};">
        </div>
        <div class="profile-trip-card__info">
          <strong>${escapeHtml(trip.name)}</strong>
          ${trip.destination ? `<span>📍 ${escapeHtml(trip.destination)}</span>` : ''}
          <span>${start}</span>
        </div>
      </a>
    `;
  }).join('');
}

// ============================================================
// PUBLISHED GUIDES
// ============================================================
async function loadPublishedGuides(userId) {
  const { data: guides, error } = await supabase
    .from('guides')
    .select('id, title, destination, cover_image, created_at')
    .eq('user_id', userId)
    .not('published_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(4);

  if (error) { console.warn('Guides load error:', error.message); return; }

  const container = document.querySelector('[data-profile-guides]');
  if (!container) return;

  setEl('[data-stat-guides]', guides?.length || 0);

  if (!guides || guides.length === 0) {
    container.innerHTML = `<p class="empty-state">No published guides yet.</p>`;
    return;
  }

  container.innerHTML = guides.map(g => `
    <a href="/guide.html?id=${g.id}" class="profile-guide-card" style="text-decoration:none;">
      <div class="profile-guide-card__cover" style="background:${g.cover_image ? `url('${g.cover_image}') center/cover` : '#A89FC822'};"></div>
      <div class="profile-guide-card__info">
        <strong>${escapeHtml(g.title)}</strong>
        ${g.destination ? `<span>${escapeHtml(g.destination)}</span>` : ''}
      </div>
    </a>
  `).join('');
}

// ============================================================
// EDIT PROFILE
// ============================================================
function showEditControls() {
  document.querySelectorAll('[data-own-only]').forEach(el => el.style.display = '');
}

function wireEditForm() {
  const form = document.querySelector('[data-edit-profile-form]');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[data-submit-btn]');
    if (submitBtn) submitBtn.disabled = true;

    const updates = {
      full_name: form.querySelector('[data-edit-name]')?.value?.trim() || null,
      bio: form.querySelector('[data-edit-bio]')?.value?.trim() || null,
      location: form.querySelector('[data-edit-location]')?.value?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', currentUserId);

    if (error) {
      showToast('Could not save changes. Please try again.', 'error');
    } else {
      showToast('Profile updated!', 'success');
      setEl('[data-profile-name]', updates.full_name || 'Traveler');
      setEl('[data-profile-bio]', updates.bio || '');
      setEl('[data-profile-location]', updates.location || '');
      closeEditModal();
    }

    if (submitBtn) submitBtn.disabled = false;
  });
}

function wireAvatarUpload(userId) {
  const avatarInput = document.querySelector('[data-avatar-upload]');
  if (!avatarInput) return;

  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop();
    const path = `avatars/${userId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      showToast('Upload failed. Please try again.', 'error');
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId);

    if (!updateError) {
      const avatarEl = document.querySelector('[data-profile-avatar]');
      if (avatarEl) avatarEl.innerHTML = `<img src="${publicUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      showToast('Avatar updated!', 'success');
    }
  });
}

// ============================================================
// MODAL HELPERS
// ============================================================
function closeEditModal() {
  const modal = document.querySelector('[data-edit-modal]');
  if (modal) modal.style.display = 'none';
}

window.openEditModal = () => {
  const modal = document.querySelector('[data-edit-modal]');
  if (modal) modal.style.display = 'flex';
};
window.closeEditModal = closeEditModal;

// ============================================================
// TOAST
// ============================================================
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
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ============================================================
// UTILITIES
// ============================================================
function setEl(sel, val) {
  const el = document.querySelector(sel);
  if (el) el.textContent = val;
}

function setInputVal(sel, val) {
  const el = document.querySelector(sel);
  if (el) el.value = val;
}

function formatDate(dateStr, yearOnly = false) {
  return new Date(dateStr).toLocaleDateString('en-US', yearOnly
    ? { month: 'long', year: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
