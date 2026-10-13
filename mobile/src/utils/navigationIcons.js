// ============================================================================
// FILE: mobile/src/utils/navigationIcons.js
// PURPOSE: Phase L - central colourful gradient palette for navigation icons
// ============================================================================

/**
 * PHASE L - COLOURFUL GRADIENT ICON REGISTRY (presentation only).
 *
 * Har navigation tab ka ek hi jagah par define kiya gaya colour identity hai:
 *   from  -> gradient ka top colour
 *   to    -> gradient ka bottom colour
 *   tint  -> label / accent colour (jab tab ACTIVE ho)
 *
 * Kyun ek registry:
 *   - Employee aur HR dono navigators ek hi mapping use karte hain, to colours
 *     duplicate nahi hote aur drift nahi karte.
 *   - Key = TAB ROUTE NAME. Isliye ek tab kabhi apne padosi ka colour nahi
 *     utha sakta. Route names Phase L me bilkul waise hi hain jaise pehle the.
 *
 * Colour discipline (taaki active/inactive dono readable rahein):
 *   - Sab gradient stops 600/700 level shades hain, isliye unke upar baitha
 *     WHITE glyph hamesha clearly visible rehta hai (>= ~4.5:1) aur
 *     tabBarActiveTintColor (tint) bhi small text ke liye AA pass karta hai.
 *   - tint values wahi hain jo app pehle se use kar raha tha (jahan function
 *     ke hisaab se zyada matching palette chahiye thi wahan Phase L ke colour
 *     guidance ke mutabik thoda align kiya gaya - sirf colour, koi logic nahi).
 *
 * NOTE: Yeh file pure data hai. Ismein koi React, navigation ya API code nahi
 * hai - sirf colours.
 */

/** Fallback identity (brand blue -> purple) agar koi unknown route name aaye. */
const FALLBACK = { from: '#2563EB', to: '#7C3AED', tint: '#2563EB' };

export const NAV_ICON_GRADIENTS = {
  // ------------------------------------------------------------------ Employee
  Dashboard: { from: '#2563EB', to: '#7C3AED', tint: '#2563EB' },        // Blue -> Purple
  Attendance: { from: '#15803D', to: '#1D4ED8', tint: '#15803D' },       // Green -> Blue
  Leave: { from: '#C2410C', to: '#D97706', tint: '#C2410C' },            // Orange -> Yellow
  Reports: { from: '#7C3AED', to: '#2563EB', tint: '#7C3AED' },          // Purple -> Blue
  BdayAnniversary: { from: '#DB2777', to: '#CA8A04', tint: '#DB2777' },  // Pink -> Gold
  FullFinal: { from: '#0F766E', to: '#15803D', tint: '#0F766E' },        // Teal -> Green
  Profile: { from: '#4F46E5', to: '#0891B2', tint: '#4F46E5' },          // Blue -> Cyan

  // ------------------------------------------------------------------ HR Admin
  Employees: { from: '#0D9488', to: '#0891B2', tint: '#0D9488' },        // Teal -> Blue/Cyan
  Audit: { from: '#7C3AED', to: '#4F46E5', tint: '#7C3AED' },            // Purple -> Indigo
  Analytics: { from: '#DB2777', to: '#7C3AED', tint: '#DB2777' },        // Pink -> Violet
  DailyMaster: { from: '#EA580C', to: '#DC2626', tint: '#EA580C' },      // Orange -> Red
  Celebrations: { from: '#CA8A04', to: '#DB2777', tint: '#CA8A04' },     // Gold -> Pink
  Marriage: { from: '#DC2626', to: '#DB2777', tint: '#DC2626' },         // Red -> Pink
  LeaveMgmt: { from: '#C2410C', to: '#D97706', tint: '#C2410C' },        // Orange -> Yellow
  Salary: { from: '#15803D', to: '#0D9488', tint: '#15803D' },           // Green -> Teal
  Holidays: { from: '#4F46E5', to: '#DB2777', tint: '#4F46E5' },         // Indigo -> Pink

  // ------------------------------------------------------- Shared / extra keys
  Credentials: { from: '#EA580C', to: '#2563EB', tint: '#EA580C' },      // Orange -> Blue
  Security: { from: '#DC2626', to: '#EA580C', tint: '#DC2626' },         // Red -> Orange
  // SuperAdmin management console home (indigo -> violet).
  Console: { from: '#4F46E5', to: '#9333EA', tint: '#4F46E5' },
  // SuperAdmin console module identities.
  Email: { from: '#2563EB', to: '#7C3AED', tint: '#2563EB' },            // Blue -> Purple
  HRAdmins: { from: '#0D9488', to: '#2563EB', tint: '#0D9488' },         // Teal -> Blue
  SuperAdmins: { from: '#9333EA', to: '#DB2777', tint: '#9333EA' },      // Purple -> Pink
};

/**
 * Get the gradient identity for a navigation route name.
 * @param {string} key tab / route name
 * @returns {{from: string, to: string, tint: string}}
 */
export const getNavIcon = (key) => NAV_ICON_GRADIENTS[key] || FALLBACK;

export default NAV_ICON_GRADIENTS;
