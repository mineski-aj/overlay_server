// GET /api/prewarm-manifest[?theme=regular|10th_anniversary|playoffs|all]
// — what html/prewarm.html downloads ahead of a show. See lib/prewarm.js.
const express = require('express');
const { buildManifest } = require('../lib/prewarm');

const router = express.Router();

router.get('/api/prewarm-manifest', (req, res) => {
  res.set('Cache-Control', 'no-store').json(buildManifest(String(req.query.theme || '')));
});

module.exports = router;
