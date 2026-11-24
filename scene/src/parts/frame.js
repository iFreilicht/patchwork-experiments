// scene.frame: the editor's verbs for pointing the camera at things.
//   - "Frame" (.): the selection, or with nothing selected the whole scene
//     ("Frame all"). Not F: F is carry's Flip, on every surface (STAGE.md, "Bodies").
//   - "Orthographic" (5): Look's projection, orthographic or perspective; the
//     picture at the focus stays as it is. Kept with the viewer's camera.
//   - "Set home view" (menu): this camera as the doc's suggested start
//     (doc.view.start.home, STAGE.md, "Arriving"), which a viewer without a saved
//     camera opens at. An edit: undo takes it back.
// Following the content as it loads is scene.autoframe's.

import { editor } from "./editor.js";

export default {
  create(api) {
    /** What Frame frames: the selection's box, if it has one, else the whole scene's. */
    const selectedBox = (view) => (view?.selected != null ? (api.focus()?.box(view.selected) ?? null) : null);

    return {
      commands: [
        {
          id: "frame",
          name: "Frame all",
          key: ".",
          group: "view",
          icon: "frame",
          state: (target, { view } = {}) => {
            if (target != null) return null;
            return selectedBox(view) ? { label: "Frame selection", title: "Frame the selection (.)" } : { title: "Frame everything (.)" };
          },
          run: () => {
            const f = api.focus();
            if (f) f.camera.frame(selectedBox(f.view.get()) ?? f.sceneBox());
          },
        },
        {
          id: "orthographic",
          name: "Orthographic",
          key: "5",
          group: "view",
          icon: "orthographic",
          show: ["toolbar"],
          state: (target, { view } = {}) => {
            if (target != null) return null;
            // the view's value says it (so the bar draws again as it switches); the camera, where there is none
            const on = (view?.projection ?? api.focus()?.camera.get()?.projection) === "orthographic";
            return { checked: on, title: on ? "Show it in perspective" : "Show it orthographic: without perspective" };
          },
          run: () => {
            const f = api.focus();
            const cam = f?.camera.get();
            if (cam) f.camera.set({ projection: cam.projection === "orthographic" ? "perspective" : "orthographic" });
          },
        },
        {
          id: "set-home",
          edit: true,
          name: "Set home view",
          show: ["menu"],
          state: (target) => (target == null ? { title: "Open this scene here for anyone without a saved view", disabled: !api.focus()?.camera.get() } : null),
          run: () => {
            const f = api.focus();
            const cam = f?.camera.get();
            if (!cam?.position) return;
            const home = { position: [...cam.position].map(Number) };
            if (Array.isArray(cam.target)) home.target = [...cam.target].map(Number);
            if (Number.isFinite(cam.fov)) home.fov = cam.fov;
            if (cam.projection === "orthographic") home.projection = "orthographic";
            editor(f).edit(
              (d) => {
                if (!d.view || typeof d.view !== "object") d.view = {};
                if (!d.view.start || typeof d.view.start !== "object") d.view.start = {};
                d.view.start.home = home;
              },
              { label: "Set home view" },
            );
          },
        },
      ],
    };
  },
};
