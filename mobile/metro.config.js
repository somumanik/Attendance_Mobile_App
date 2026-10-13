// Expo project → the Metro config MUST come from `expo/metro-config`.
// Using `@react-native/metro-config` (bare React Native) here registers the
// wrong serializer, which makes `expo export` fail with:
//   "Serializer did not return expected format. The project copy of
//    `expo/metro-config` may be out of date."
// (The dev server tolerated it; the export path requires Expo's serializer.)
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
