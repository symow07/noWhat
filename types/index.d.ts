// The session values noWhat keeps in $.state.

/** A feature id, or null when no feature is active. */
export type NowhatFeatureId = string | null

declare module 'claude-code' {
  interface PluginState {
    nowhat: {
      /** The feature Claude last put in progress: file edits are filed under it. */
      activeFeature: NowhatFeatureId
      /** Files edited this session while no feature was active. */
      unassignedFiles: string[]
      /** The status line last handed to the model, so it is only sent again when it changes. */
      lastContext: string
      /** This session's first prompt, which names it in last_conversation. */
      sessionTitle: string | null
      /** Bumped on every write of .claude/nowhat.json, so the pane draws it again. */
      revision: number
      /** Pane sections the person toggled away from their default (open or closed). */
      openSections: string[]
      /** The feature whose details the pane shows, if any. */
      expandedFeature: NowhatFeatureId
      /** This project's dashboard or every project's card; null until the person picks one. */
      paneView: 'project' | 'all' | null
      /** The project whose card the all-projects view shows opened, by path. */
      expandedProject: string | null
      /** The tab open under Next up. */
      tab: 'features' | 'needs' | 'decisions' | 'launch'
      /** A detection is running: the header says "checking…". */
      checking: boolean
      /** Bumped after an idea is captured, so the capture field draws empty again. */
      captureGeneration: number
      /** When the person last opened this project before this session, for "since your last visit". */
      previousVisit: string | null
      /** Commit subjects since that visit. */
      visitCommits: string[]
      /** Whether this session's visit is already recorded (hot reloads must not record it again). */
      visitRecorded: boolean
      /** The person ran /nowhat (or pressed Set up) in this session: only then may setup save and register the project. */
      setupRequested: boolean
    }
  }
}
