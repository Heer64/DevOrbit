Sprint 6 E2E test additions (DRAFT — execute locally before claiming PASS).

Copy the three .spec.js files to DevOrbit/e2e/tests/ (not the README).
On branch testing/sprint6-testing, from DevOrbit/e2e run:
  npx playwright test "sprint6-.*\.spec\.js"

Coverage:
- M1 password-reset form safeguards and invalid-token UI (2 tests)
- M3 Copilot question validation, M4 no-evidence grounding (2 tests)
- M5 Catch Me Up empty activity case (1 test)

Existing M2, M6, M7, M8 tests in repo are not duplicated.
These tests do not establish successful email delivery, real LLM answers,
or full coverage of all edge cases.
