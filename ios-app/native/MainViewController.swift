import UIKit
import Capacitor

// Makes sure the app's own Apple Music plugin is registered with the web view. The plugin is also listed
// in capacitor.config.json (packageClassList) by scripts/ios-setup.sh, which is the usual way plugins load.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        if bridge?.plugin(withName: "AppleMusic") == nil {
            bridge?.registerPluginInstance(AppleMusicPlugin())
        }
    }
}
