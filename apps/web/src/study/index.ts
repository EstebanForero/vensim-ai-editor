// The study tab's public surface: one component, and the reason it exists.
//
// This file is the *only* thing the editor imports from here — `App.tsx` renders `<StudyPanel />`
// as one more tab alongside the inspector and the chat. Everything the tab needs it brings with
// it (its modes, its session, its transcript), and it depends on the editor in one direction only:
// the store's model and connection, the shared chat rendering, the canvas. Deleting this folder
// would cost exactly two lines in App.tsx and leave the editor working, which is what "the base
// app doesn't depend on the study tab" has to mean in one bundle.

export { StudyPanel } from "./StudyPanel";
