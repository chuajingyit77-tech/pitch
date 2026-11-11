#!/bin/sh
# Assemble the single-file app from its parts.
cd "$(dirname "$0")"
{ cat part1.html; echo '<style>[hidden]{display:none!important}</style>'; echo '<script>'; cat part2.js part3.js part4.js; echo '</script>'; } > app.html
