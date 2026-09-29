'use strict';
// Runs before every test file (jest "setupFiles"). The tests configure the app
// through environment variables only: a developer's opspoint.config.json must
// never hand them a real database, profile or data folder.
process.env.OPSPOINT_CONFIG = 'none';
