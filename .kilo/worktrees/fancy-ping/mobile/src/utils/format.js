// ============================================================================
// FILE: mobile/src/utils/format.js
// PURPOSE: Formatting helpers for dates, times, numbers
// ============================================================================

/**
 * Ye file date, time, aur number formatting ke helper functions provide karti hai.
 * Backend se aane wale data ko mobile-friendly format mein convert karti hai.
 */

// Date formatting - backend se ISO date string aati hai (YYYY-MM-DD)
export const formatDate = (dateString, options = {}) => {
  if (!dateString) return '—';
  const date = new Date(dateString + 'T00:00:00'); // Local date parsing
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  });
};

// Full date with day name
export const formatDateFull = (dateString) => {
  if (!dateString) return '—';
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

// Time formatting - backend se time string aati hai (HH:MM:SS or ISO)
export const formatTime = (timeString) => {
  if (!timeString) return '—';
  // Handle HH:MM:SS format
  if (timeString.includes(':')) {
    const parts = timeString.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
  }
  return timeString;
};

// Hours formatting - decimal hours to readable format
export const formatHours = (hours) => {
  if (hours === null || hours === undefined) return '—';
  const h = Number(hours);
  if (isNaN(h)) return '—';
  if (h === 0) return '0h';
  const wholeHours = Math.floor(h);
  const minutes = Math.round((h - wholeHours) * 60);
  if (minutes === 0) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes.toString().padStart(2, '0')}m`;
};

// Percentage formatting
export const formatPercentage = (value, decimals = 1) => {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(decimals)}%`;
};

// Number formatting with commas
export const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-IN');
};

// Status label mapping - matches backend classifyRow()
export const getStatusLabel = (statusCode) => {
  const code = String(statusCode || '').trim().toUpperCase();
  const labels = {
    P: 'Present',
    PRESENT: 'Present',
    HLF: 'Half Day',
    HALF: 'Half Day',
    'HALF DAY': 'Half Day',
    SRT: 'Short Leave',
    SHORT: 'Short Leave',
    POW: 'Present (Week Off)',
    'PRESENT ON WEEK OFF': 'Present (Week Off)',
    LATE: 'Late',
    A: 'Absent',
    ABS: 'Absent',
    ABSENT: 'Absent',
    MIS: 'Miss Punch',
    MISS: 'Miss Punch',
    'MISS PUNCH': 'Miss Punch',
    MISPUNCH: 'Miss Punch',
    WO: 'Week Off',
    'WEEK OFF': 'Week Off',
    WEEKOFF: 'Week Off',
    H: 'Holiday',
    HOLIDAY: 'Holiday',
  };
  return labels[code] || code || 'Unknown';
};

// Status color mapping
export const getStatusColor = (statusCode) => {
  const code = String(statusCode || '').trim().toUpperCase();
  if (['P', 'PRESENT', 'HLF', 'HALF', 'HALF DAY', 'SRT', 'SHORT', 'POW', 'PRESENT ON WEEK OFF', 'LATE'].includes(code)) {
    return '#059669'; // Green
  }
  if (['A', 'ABS', 'ABSENT'].includes(code)) {
    return '#DC2626'; // Red
  }
  if (['MIS', 'MISS', 'MISS PUNCH', 'MISPUNCH'].includes(code)) {
    return '#D97706'; // Amber
  }
  if (['WO', 'WEEK OFF', 'WEEKOFF', 'H', 'HOLIDAY'].includes(code)) {
    return '#64748B'; // Slate
  }
  return '#64748B';
};

// Truncate text with ellipsis
export const truncate = (text, maxLength = 30) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

// Capitalize first letter
export const capitalize = (text) => {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};