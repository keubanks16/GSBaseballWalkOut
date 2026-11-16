#!/usr/bin/env bash
# Builds the iPhone project in ios-app/ios from this repo (run by the GitHub Actions workflow on a Mac).
set -euo pipefail
cd "$(dirname "$0")/.."
APP_NAME="$(node -p "require('./capacitor.config.json').appName")"

npm install --no-audit --no-fund
node scripts/build-www.mjs
if [ ! -d ios/App ]; then npx cap add ios --packagemanager SPM; fi

# Native code: app delegate, the view controller that registers the Apple Music plugin, and the plugin.
cp native/AppDelegate.swift ios/App/App/AppDelegate.swift
cp native/MainViewController.swift native/AppleMusicPlugin.swift ios/App/App/
# Point the storyboard at our view controller so the plugin gets registered.
SB=ios/App/App/Base.lproj/Main.storyboard
sed -i '' -e 's/customClass="CAPBridgeViewController" customModule="Capacitor"/customClass="MainViewController" customModule="App" customModuleProvider="target"/' "$SB"
grep -q 'customClass="MainViewController"' "$SB" || { echo "::error::Could not point Main.storyboard at MainViewController"; exit 1; }

ICONSET=ios/App/App/Assets.xcassets/AppIcon.appiconset
for f in "$ICONSET"/*.png; do [ -e "$f" ] && cp native/assets/AppIcon-1024.png "$f"; done
SPLASH=ios/App/App/Assets.xcassets/Splash.imageset
for f in "$SPLASH"/*.png; do [ -e "$f" ] && cp native/assets/splash-2732.png "$f"; done

PL=ios/App/App/Info.plist
setk() { /usr/libexec/PlistBuddy -c "Delete :$1" "$PL" >/dev/null 2>&1 || true; /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PL"; }
setk CFBundleDisplayName string "$APP_NAME"
setk ITSAppUsesNonExemptEncryption bool false
setk NSAppleMusicUsageDescription string "Pick walkout songs from your Music library and play them when each player comes up to bat."
setk NSMicrophoneUsageDescription string "Record your own voice announcing a player."
/usr/libexec/PlistBuddy -c "Delete :UIBackgroundModes" "$PL" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$PL"
/usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:0 string audio" "$PL"

gem list -i xcodeproj >/dev/null 2>&1 || gem install --user-install xcodeproj
ruby scripts/ios-project.rb
npx cap sync ios

# Register the app's own plugin the same way installed plugins are: by class name in the bundled config.
node -e '
const fs = require("fs"), f = "ios/App/App/capacitor.config.json";
const c = JSON.parse(fs.readFileSync(f, "utf8"));
c.packageClassList = Array.from(new Set([...(c.packageClassList || []), "AppleMusicPlugin"]));
fs.writeFileSync(f, JSON.stringify(c, null, "\t"));
console.log("packageClassList:", c.packageClassList.join(", "));
'
grep -q AppleMusicPlugin ios/App/App/capacitor.config.json || { echo "::error::AppleMusicPlugin is not in the bundled capacitor.config.json"; exit 1; }
echo "iOS project ready in ios-app/ios/App"
