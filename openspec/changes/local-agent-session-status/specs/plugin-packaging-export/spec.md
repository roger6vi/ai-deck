# plugin-packaging-export Delta Spec

## ADDED Requirements

### Requirement: Local portable profile
The plugin package/profile MUST work on the original 15-key Stream Deck, export from the personal Mac, install locally on the work Mac, and allow only the relevant adapter to be enabled. It MUST NOT require cloud relay, marketplace release, cross-machine sync, prompts, transcripts, tool output, or secrets.

#### Scenario: Transfer to work Mac
- GIVEN a package/profile exported from the personal Mac
- WHEN it is installed locally on the work Mac
- THEN the five-key profile works on the 15-key device with only the work-relevant adapter enabled

### Requirement: Private runtime exclusion before packaging
The package workflow MUST create an isolated staging directory that excludes runtime and private paths before `streamdeck pack` runs. `runtime/endpoint.json`, bearer tokens, logs, snapshots, source, tests, and build-recovery directories MUST NOT enter staging or the distributable. The source plugin runtime record MUST remain untouched. Pack and downstream validation MUST share one cleanup boundary that surfaces cleanup failures with the primary error; recovery is local removal of `.package-stage` and failed archive before re-running pack, with no cloud logging.

#### Scenario: Runtime token is excluded from stage and archive
- GIVEN the source plugin root contains `runtime/endpoint.json` with a bearer-token sentinel
- WHEN package staging and archive creation run
- THEN the source record is unchanged while neither the staged plugin nor the distributable contains the runtime file or sentinel

#### Scenario: Packaging fails after staging
- GIVEN a known-good prior archive is removed before packing, then an unsafe new archive is created and downstream validation fails
- WHEN the package command returns failure
- THEN it leaves no new archive containing private data and removes the isolated stage
