// 栖境 · where the company's lessons and learning records live: the learning backend (Supabase project
// `qijing-learning`, its database in backend/*.sql).
//
// Both values are meant to be public (they are in every page that uses them): the key only lets a page call the
// backend's functions, and each of those checks a screen's or an admin's token itself. Nothing about the company —
// lessons, staff, records — is in this repository; it all stays in the backend.
export const BACKEND = {
  url: 'https://cqzhlxmbejkcuryfrlol.supabase.co',
  key: 'sb_publishable_CTiLL4K1kJd8Fl3MINbV_g_9TPFok4d',
};
