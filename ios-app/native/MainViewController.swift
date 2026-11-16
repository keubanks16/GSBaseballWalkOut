import UIKit
import Capacitor

// Registers the app's own Apple Music plugin with the web view.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleMusicPlugin())
    }
}
