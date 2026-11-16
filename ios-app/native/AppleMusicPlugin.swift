import Foundation
import Capacitor
import MediaPlayer

// Lets the web app pick a song from the phone's Music library (including Apple Music subscription
// songs added to the library) and play it from a start point, the way BallparkDJ does.
// JS: Capacitor.nativePromise('AppleMusic', 'pick' | 'play' | 'stop' | 'status', {...})
@objc(AppleMusicPlugin)
public class AppleMusicPlugin: CAPPlugin, CAPBridgedPlugin, MPMediaPickerControllerDelegate {
    public let identifier = "AppleMusicPlugin"
    public let jsName = "AppleMusic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise)
    ]

    // Two ways to play: inside this app, or by driving the phone's own Music app (the fallback).
    private let appPlayer = MPMusicPlayerController.applicationQueuePlayer
    private let sysPlayer = MPMusicPlayerController.systemMusicPlayer
    private var usingSystem = false
    private var pickCall: CAPPluginCall?
    // Music player calls can stall for seconds, so they never run on the main thread.
    private let work = DispatchQueue(label: "gswalkout.applemusic", qos: .userInitiated)

    private func authName() -> String {
        switch MPMediaLibrary.authorizationStatus() {
        case .authorized: return "allowed"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not asked"
        @unknown default: return "unknown"
        }
    }

    private func withAccess(_ call: CAPPluginCall, _ run: @escaping () -> Void) {
        if MPMediaLibrary.authorizationStatus() == .authorized { run(); return }
        MPMediaLibrary.requestAuthorization { status in
            if status == .authorized { run() } else { call.reject("Allow Media & Apple Music for GS Walkout in the iPhone Settings app, then try again.") }
        }
    }

    // ping() -> { ok, auth }: answers right away without touching the music player (used to check the plugin loaded).
    @objc func ping(_ call: CAPPluginCall) {
        call.resolve(["ok": true, "auth": authName()])
    }

    @objc func pick(_ call: CAPPluginCall) {
        withAccess(call) {
            DispatchQueue.main.async {
                guard let vc = self.bridge?.viewController else { call.reject("Could not open the Music library."); return }
                let picker = MPMediaPickerController(mediaTypes: .music)
                picker.allowsPickingMultipleItems = false
                picker.showsCloudItems = true
                picker.delegate = self
                self.pickCall = call
                vc.present(picker, animated: true)
            }
        }
    }

    public func mediaPicker(_ mediaPicker: MPMediaPickerController, didPickMediaItems mediaItemCollection: MPMediaItemCollection) {
        mediaPicker.dismiss(animated: true)
        guard let call = pickCall else { return }
        pickCall = nil
        guard let item = mediaItemCollection.items.first else { call.resolve(["cancelled": true]); return }
        call.resolve([
            "persistentId": String(item.persistentID),
            "storeId": item.playbackStoreID,
            "name": item.title ?? "Song",
            "artist": item.artist ?? "",
            "dur": item.playbackDuration
        ])
    }

    public func mediaPickerDidCancel(_ mediaPicker: MPMediaPickerController) {
        mediaPicker.dismiss(animated: true)
        pickCall?.resolve(["cancelled": true])
        pickCall = nil
    }

    // play({ persistentId, storeId, start, system }) -> { steps } ; "system" uses the phone's Music app.
    @objc func play(_ call: CAPPluginCall) {
        let pid = call.getString("persistentId") ?? ""
        let sid = call.getString("storeId") ?? ""
        let start = call.getDouble("start") ?? 0
        let system = call.getBool("system") ?? false
        withAccess(call) {
            self.work.async {
                var steps = "access"
                let player = system ? self.sysPlayer : self.appPlayer
                if self.usingSystem != system { (system ? self.appPlayer : self.sysPlayer).pause() }
                var queued = false
                if let n = UInt64(pid), n != 0 {
                    let q = MPMediaQuery.songs()
                    q.addFilterPredicate(MPMediaPropertyPredicate(value: NSNumber(value: n), forProperty: MPMediaItemPropertyPersistentID))
                    if let item = q.items?.first {
                        let d = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: [item]))
                        if start > 0 { d.setStartTime(start, for: item) }
                        player.setQueue(with: d)
                        queued = true
                        steps += ",library"
                    }
                }
                if !queued {
                    if sid.isEmpty || sid == "0" { call.reject("That song is not in this phone's Music library."); return }
                    let d = MPMusicPlayerStoreQueueDescriptor(storeIDs: [sid])
                    if start > 0 { d.setStartTime(start, forItemWithStoreID: sid) }
                    player.setQueue(with: d)
                    steps += ",store"
                }
                player.repeatMode = .none
                player.shuffleMode = .off
                self.usingSystem = system
                player.play()
                steps += ",play"
                call.resolve(["steps": steps])
            }
        }
    }

    // status() -> { auth, state (0 stopped, 1 playing, 2 paused, 3 interrupted), item, time, player }
    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            let p = self.usingSystem ? self.sysPlayer : self.appPlayer
            let t = p.currentPlaybackTime
            call.resolve([
                "auth": self.authName(),
                "state": p.playbackState.rawValue,
                "item": p.nowPlayingItem?.title ?? "",
                "time": t.isNaN ? 0 : t,
                "player": self.usingSystem ? "system" : "app"
            ])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        work.async {
            if self.usingSystem { self.sysPlayer.pause() } else { self.appPlayer.stop() }
            call.resolve()
        }
    }
}
