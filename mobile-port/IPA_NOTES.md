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

## Windows-only path

You cannot build and sign an IPA directly on Windows. Use a cloud Mac builder:

1. Push this project to GitHub.
2. Connect the repository to Codemagic.
3. Let Codemagic read the root `codemagic.yaml`.
4. Run `Anime Hub iOS Test Wrapper` first.
5. After the unsigned validation build succeeds, add Apple signing in Codemagic to export a real `.ipa`.

There is also a GitHub Actions backup workflow at `.github/workflows/ios-validation.yml`.
After pushing to GitHub, open Actions > iOS Validation Build > Run workflow.
That workflow verifies the iOS project on a hosted Mac, but it does not create an installable signed IPA by itself.

## To get a real IPA from Windows

1. Create or use an Apple Developer account.
2. Add the app id `com.animehub.mobile` in Apple Developer.
3. Create an iOS signing certificate and provisioning profile, or connect App Store Connect to Codemagic.
4. Add signing to the Codemagic workflow.
5. Run Codemagic again and download the signed `.ipa` artifact.

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
