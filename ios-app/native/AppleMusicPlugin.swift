import Foundation
import Capacitor
import MediaPlayer

// Lets the web app pick a song from the phone's Music library (including Apple Music subscription
// songs added to the library) and play it from a start point, the way BallparkDJ does.
// JS: Capacitor.Plugins.AppleMusic.pick() / play({persistentId, storeId, start}) / stop()
@objc(AppleMusicPlugin)
public class AppleMusicPlugin: CAPPlugin, CAPBridgedPlugin, MPMediaPickerControllerDelegate {
    public let identifier = "AppleMusicPlugin"
    public let jsName = "AppleMusic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let player = MPMusicPlayerController.applicationQueuePlayer
    private var pickCall: CAPPluginCall?

    private func withAccess(_ call: CAPPluginCall, _ run: @escaping () -> Void) {
        MPMediaLibrary.requestAuthorization { status in
            DispatchQueue.main.async {
                if status == .authorized { run() } else { call.reject("Allow Media & Apple Music for GS Walkout in the iPhone Settings app, then try again.") }
            }
        }
    }

    @objc func pick(_ call: CAPPluginCall) {
        withAccess(call) {
            guard let vc = self.bridge?.viewController else { call.reject("Could not open the Music library."); return }
            let picker = MPMediaPickerController(mediaTypes: .music)
            picker.allowsPickingMultipleItems = false
            picker.showsCloudItems = true
            picker.delegate = self
            self.pickCall = call
            vc.present(picker, animated: true)
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

    @objc func play(_ call: CAPPluginCall) {
        let pid = call.getString("persistentId") ?? ""
        let sid = call.getString("storeId") ?? ""
        let start = call.getDouble("start") ?? 0
        withAccess(call) {
            // Queue the song with its start point built in, so it begins at the right spot.
            var queued = false
            if let n = UInt64(pid), n != 0 {
                let q = MPMediaQuery.songs()
                q.addFilterPredicate(MPMediaPropertyPredicate(value: NSNumber(value: n), forProperty: MPMediaItemPropertyPersistentID))
                if let item = q.items?.first {
                    let d = MPMusicPlayerMediaItemQueueDescriptor(itemCollection: MPMediaItemCollection(items: [item]))
                    if start > 0 { d.setStartTime(start, for: item) }
                    self.player.setQueue(with: d)
                    queued = true
                }
            }
            if !queued {
                if sid.isEmpty || sid == "0" { call.reject("That song is not in this phone's Music library."); return }
                let d = MPMusicPlayerStoreQueueDescriptor(storeIDs: [sid])
                if start > 0 { d.setStartTime(start, forItemWithStoreID: sid) }
                self.player.setQueue(with: d)
            }
            self.player.repeatMode = .none
            self.player.shuffleMode = .off
            // prepareToPlay sometimes never answers, so start anyway after a few seconds.
            var done = false
            let finish: (Error?) -> Void = { error in
                if done { return }
                done = true
                if let e = error as NSError? {
                    call.reject("Apple Music could not play that song (\(e.domain) \(e.code)): \(e.localizedDescription)")
                    return
                }
                self.player.play()
                call.resolve()
                if start > 1 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        if self.player.playbackState == .playing && self.player.currentPlaybackTime < start - 1 { self.player.currentPlaybackTime = start }
                    }
                }
            }
            self.player.prepareToPlay { error in DispatchQueue.main.async { finish(error) } }
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { finish(nil) }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player.stop()
            call.resolve()
        }
    }
}
