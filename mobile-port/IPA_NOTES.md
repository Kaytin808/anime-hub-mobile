# Anime Hub iPhone Build Notes

This mobile port is prepared for a Capacitor iOS wrapper.

## What is configured

- Capacitor app id: `com.animehub.mobile`
- App name: `Anime Hub`
- iPhone test server URL: `http://192.168.0.250:3010`
- Cleartext HTTP enabled for local network testing

## Build requirements

Creating a signed `.ipa` requires:

- macOS
- Xcode
- Apple Developer account or local signing team
- The backend server reachable from the iPhone at `http://192.168.0.250:4000`
- The mobile web server reachable from the iPhone at `http://192.168.0.250:3010`

## Windows-only path for an IPA

You cannot build and sign an IPA directly on Windows. You can still make a private sideload IPA by using a cloud Mac builder:

1. Push this project to GitHub.
2. Connect the repository to Codemagic.
3. Let Codemagic read the root `codemagic.yaml`.
4. Run `Anime Hub iOS Test Wrapper` first.
5. After the unsigned validation build succeeds, set up Apple signing in Codemagic.
6. Run `Anime Hub Personal Sideload IPA`.
7. Download the `.ipa` artifact from Codemagic.
8. Install that IPA on your iPhone from Windows using Sideloadly, AltStore, or another sideload installer.

There is also a GitHub Actions backup workflow at `.github/workflows/ios-validation.yml`.
After pushing to GitHub, open Actions > iOS Validation Build > Run workflow.
That workflow verifies the iOS project on a hosted Mac, but it does not create an installable signed IPA by itself.

## Personal sideload signing

The Codemagic workflow `Anime Hub Personal Sideload IPA` is configured for Ad Hoc signing:

- Bundle ID: `com.animehub.mobile`
- Distribution type: `ad_hoc`
- App Store release: not required

To use Ad Hoc signing:

1. Create or use an Apple Developer account.
2. Register your iPhone UDID in Apple Developer.
3. Add the app id `com.animehub.mobile`.
4. Create an Apple Distribution certificate.
5. Create an Ad Hoc provisioning profile for `com.animehub.mobile` that includes your iPhone.
6. Add the certificate and profile to Codemagic code signing identities.
7. Run `Anime Hub Personal Sideload IPA`.

If you use Sideloadly with a free Apple ID, the app may expire and need refreshing. A paid Apple Developer account with Ad Hoc signing is the more reliable private-only route.

## Mac commands

```bash
cd mobile-port
npm install
npx cap sync ios
npx cap open ios
```

Then in Xcode:

1. Select the `App` target.
2. Set a signing team.
3. Pick a connected iPhone or Any iOS Device.
4. Use Product > Archive.
5. Distribute the archive as an Ad Hoc, Development, or TestFlight build.

## Important

This first iOS wrapper loads the local mobile web server. It is for device testing.
A final App Store-style build should either use a real HTTPS backend/web host or a fully bundled static mobile frontend.
