Chord Inversions Game

A small webapp that uses the Web MIDI API to let you test chord inversions. The app requests a chord (e.g., C Major) and an inversion (e.g., 1st inversion). Play the chord on your MIDI keyboard; the app checks both the pitch classes and the bass note (lowest note) to verify the inversion.

Quick start:

1. Install dependencies: npm install
2. Start server: npm start
3. Open http://localhost:3000 in a browser that supports Web MIDI (Chrome/Edge). Localhost is a secure context for MIDI.

If you don't have a MIDI keyboard, use the on-screen keyboard to simulate notes.
