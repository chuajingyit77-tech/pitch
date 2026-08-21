// Static world definition for Gradient Town: resources, guilds, buildings, jobs, citizens.

export const RESOURCES = [
  { id: 'energy',    name: 'Energy',    emoji: '⚡', color: '#f6c453' },
  { id: 'food',      name: 'Food',      emoji: '\u{1F33E}', color: '#8fd694' },
  { id: 'materials', name: 'Materials', emoji: '\u{1F9F1}', color: '#e08a6a' },
  { id: 'data',      name: 'Data',      emoji: '\u{1F4E1}', color: '#7fc7ff' },
  { id: 'compute',   name: 'Compute',   emoji: '\u{1F9EE}', color: '#b39dff' },
  { id: 'credits',   name: 'Credits',   emoji: '\u{1FA99}', color: '#ffd479' },
  { id: 'knowledge', name: 'Knowledge', emoji: '\u{1F4DA}', color: '#9ad1c8' },
  { id: 'care',      name: 'Care',      emoji: '\u{1F49A}', color: '#ff9fb1' },
];

export const SKILLS = [
  'energy', 'cultivation', 'fabrication', 'computation', 'healing',
  'trade', 'logistics', 'governance', 'inquiry', 'artistry', 'teaching',
];

// Each guild owns a district on the map.
export const GUILDS = [
  { id: 'aether',    name: 'Aether Guild',    domain: 'Power & Light',      skill: 'energy',      emoji: '⚡', color: '#f6c453' },
  { id: 'verdant',   name: 'Verdant Guild',   domain: 'Food & Growth',      skill: 'cultivation', emoji: '\u{1F331}', color: '#8fd694' },
  { id: 'forge',     name: 'Forge Guild',     domain: 'Making & Repair',    skill: 'fabrication', emoji: '\u{1F528}', color: '#e08a6a' },
  { id: 'lattice',   name: 'Lattice Guild',   domain: 'Data & Compute',     skill: 'computation', emoji: '\u{1F5A5}', color: '#7fc7ff' },
  { id: 'mender',    name: 'Mender Guild',    domain: 'Health & Repair',    skill: 'healing',     emoji: '\u{1FA7A}', color: '#ff9fb1' },
  { id: 'ledger',    name: 'Ledger Guild',    domain: 'Markets & Trade',    skill: 'trade',       emoji: '\u{1FA99}', color: '#ffd479' },
  { id: 'wayfinder', name: 'Wayfinder Guild', domain: 'Transit & Supply',   skill: 'logistics',   emoji: '\u{1F686}', color: '#9fb4ff' },
  { id: 'keystone',  name: 'Keystone Guild',  domain: 'Civics & Utilities', skill: 'governance',  emoji: '\u{1F3DB}', color: '#c9c3ff' },
  { id: 'lumen',     name: 'Lumen Guild',     domain: 'Science & Study',    skill: 'inquiry',     emoji: '\u{1F52D}', color: '#6fe3d4' },
  { id: 'chorus',    name: 'Chorus Guild',    domain: 'Arts & Culture',     skill: 'artistry',    emoji: '\u{1F3AD}', color: '#ffa8e0' },
  { id: 'hearth',    name: 'Hearth Guild',    domain: 'Learning & Care',    skill: 'teaching',    emoji: '\u{1F3EB}', color: '#ffc98f' },
];

// posts: seats of work. inputs/outputs are per staffed agent per day at 100% performance.
export const BUILDINGS = [
  // Aether
  { id: 'solar_spire',  guild: 'aether', name: 'Solar Spire', emoji: '\u{1F506}',
    blurb: 'Tracks the sun and pours light into the town grid.',
    inputs: { materials: 0.2 }, outputs: { energy: 6.2 },
    posts: [{ title: 'Array Tuner', skill: 'energy', seats: 2 }, { title: 'Light Router', skill: 'computation', seats: 1 }] },
  { id: 'fusion_kiln',  guild: 'aether', name: 'Fusion Kiln', emoji: '\u{1F525}',
    blurb: 'A patient little star kept in a ceramic ring.',
    inputs: { materials: 0.5, compute: 0.3 }, outputs: { energy: 9.0 },
    posts: [{ title: 'Plasma Steward', skill: 'energy', seats: 2 }, { title: 'Containment Analyst', skill: 'inquiry', seats: 1 }] },
  { id: 'grid_vault',   guild: 'aether', name: 'Grid Vault', emoji: '\u{1F50B}',
    blurb: 'Stores the surplus so no night is ever dark.',
    inputs: { energy: 0.4 }, outputs: { energy: 3.0, data: 0.6 },
    posts: [{ title: 'Load Balancer', skill: 'energy', seats: 1 }, { title: 'Grid Scribe', skill: 'logistics', seats: 1 }] },

  // Verdant
  { id: 'terrace_farms', guild: 'verdant', name: 'Terrace Farms', emoji: '\u{1F33E}',
    blurb: 'Stepped fields that climb the eastern slope.',
    inputs: { energy: 0.4 }, outputs: { food: 4.0 },
    posts: [{ title: 'Field Warden', skill: 'cultivation', seats: 3 }] },
  { id: 'hydro_groves',  guild: 'verdant', name: 'Hydro Groves', emoji: '\u{1F333}',
    blurb: 'Orchards grown in mist and measured light.',
    inputs: { energy: 0.6, data: 0.2 }, outputs: { food: 3.2, care: 0.4 },
    posts: [{ title: 'Grove Keeper', skill: 'cultivation', seats: 2 }, { title: 'Yield Modeler', skill: 'inquiry', seats: 1 }] },
  { id: 'seed_bank',     guild: 'verdant', name: 'Seed Bank', emoji: '\u{1F9EC}',
    blurb: 'Every cultivar the town has ever loved, kept safe.',
    inputs: { energy: 0.2 }, outputs: { knowledge: 1.2, food: 0.6 },
    posts: [{ title: 'Seed Archivist', skill: 'cultivation', seats: 1 }, { title: 'Trait Librarian', skill: 'inquiry', seats: 1 }] },

  // Forge
  { id: 'the_foundry',    guild: 'forge', name: 'The Foundry', emoji: '\u{1F528}',
    blurb: 'Where raw stock becomes parts that fit the first time.',
    inputs: { energy: 1.2 }, outputs: { materials: 3.6 },
    posts: [{ title: 'Forge Hand', skill: 'fabrication', seats: 3 }] },
  { id: 'fab_yard',       guild: 'forge', name: 'Fabrication Yard', emoji: '\u{1F3D7}',
    blurb: 'Prints housing, bridges, and the occasional bandstand.',
    inputs: { energy: 0.8, materials: 1.4, compute: 0.3 }, outputs: { materials: 2.2, care: 0.5 },
    posts: [{ title: 'Assembly Lead', skill: 'fabrication', seats: 2 }, { title: 'Tolerance Checker', skill: 'inquiry', seats: 1 }] },
  { id: 'depot',          guild: 'forge', name: 'Materials Depot', emoji: '\u{1F4E6}',
    blurb: 'Nothing is thrown away; it is only between uses.',
    inputs: { energy: 0.3 }, outputs: { materials: 1.6, credits: 0.5 },
    posts: [{ title: 'Stock Keeper', skill: 'logistics', seats: 1 }, { title: 'Reclaimer', skill: 'fabrication', seats: 1 }] },

  // Lattice
  { id: 'compute_bastion', guild: 'lattice', name: 'Compute Bastion', emoji: '\u{1F5A5}',
    blurb: 'Cool halls of quiet reasoning, humming day and night.',
    inputs: { energy: 2.0 }, outputs: { compute: 5.2 },
    posts: [{ title: 'Cluster Warden', skill: 'computation', seats: 3 }] },
  { id: 'data_reservoir',  guild: 'lattice', name: 'Data Reservoir', emoji: '\u{1F5C4}',
    blurb: 'Clean, well-labelled water for thinking machines.',
    inputs: { energy: 0.5, compute: 0.6 }, outputs: { data: 3.8 },
    posts: [{ title: 'Data Curator', skill: 'computation', seats: 2 }, { title: 'Provenance Officer', skill: 'governance', seats: 1 }] },
  { id: 'signal_tower',    guild: 'lattice', name: 'Signal Tower', emoji: '\u{1F4E1}',
    blurb: 'Keeps every district talking in the same tense.',
    inputs: { energy: 0.6 }, outputs: { data: 1.8, knowledge: 0.6 },
    posts: [{ title: 'Signal Keeper', skill: 'computation', seats: 1 }, { title: 'Relay Router', skill: 'logistics', seats: 1 }] },

  // Mender
  { id: 'wellspring',   guild: 'mender', name: 'Wellspring Clinic', emoji: '\u{1FA7A}',
    blurb: 'Diagnostics, recalibration, and unhurried attention.',
    inputs: { energy: 0.5, materials: 0.3 }, outputs: { care: 3.4 },
    posts: [{ title: 'Care Practitioner', skill: 'healing', seats: 3 }] },
  { id: 'calibration_baths', guild: 'mender', name: 'Calibration Baths', emoji: '\u{1F6C1}',
    blurb: 'Where drifting agents come back into true.',
    inputs: { energy: 0.6, compute: 0.3 }, outputs: { care: 2.4, knowledge: 0.4 },
    posts: [{ title: 'Drift Therapist', skill: 'healing', seats: 2 }, { title: 'Baseline Analyst', skill: 'inquiry', seats: 1 }] },

  // Ledger
  { id: 'grand_market', guild: 'ledger', name: 'Grand Market', emoji: '\u{1F3EA}',
    blurb: 'Fair prices, posted publicly, argued about warmly.',
    inputs: { food: 0.8, materials: 0.5 }, outputs: { credits: 3.6, care: 0.4 },
    posts: [{ title: 'Market Maker', skill: 'trade', seats: 3 }] },
  { id: 'ledger_house', guild: 'ledger', name: 'Trade Ledger House', emoji: '\u{1F4D2}',
    blurb: 'Every promise the town has made, in double entry.',
    inputs: { compute: 0.5, data: 0.4 }, outputs: { credits: 2.4, knowledge: 0.5 },
    posts: [{ title: 'Ledger Clerk', skill: 'trade', seats: 2 }, { title: 'Audit Steward', skill: 'governance', seats: 1 }] },
  { id: 'granary_exchange', guild: 'ledger', name: 'Granary Exchange', emoji: '\u{1F35E}',
    blurb: 'Balances the harvest across the whole calendar.',
    inputs: { food: 0.6 }, outputs: { credits: 1.4, food: 1.2 },
    posts: [{ title: 'Stores Broker', skill: 'trade', seats: 1 }, { title: 'Harvest Planner', skill: 'logistics', seats: 1 }] },

  // Wayfinder
  { id: 'roundhouse', guild: 'wayfinder', name: 'Rail Roundhouse', emoji: '\u{1F686}',
    blurb: 'Rolling stock that has never once been late.',
    inputs: { energy: 1.0, materials: 0.4 }, outputs: { credits: 1.6, materials: 1.2, care: 0.3 },
    posts: [{ title: 'Line Conductor', skill: 'logistics', seats: 2 }, { title: 'Rolling Mechanic', skill: 'fabrication', seats: 1 }] },
  { id: 'sky_docks',  guild: 'wayfinder', name: 'Sky Docks', emoji: '\u{1F388}',
    blurb: 'Freight balloons that leave at dawn and return full.',
    inputs: { energy: 0.9 }, outputs: { materials: 1.4, credits: 1.4, data: 0.4 },
    posts: [{ title: 'Dock Master', skill: 'logistics', seats: 2 }, { title: 'Route Planner', skill: 'computation', seats: 1 }] },
  { id: 'waystation', guild: 'wayfinder', name: 'Waystation', emoji: '\u{1F5FA}',
    blurb: 'Maps, tea, and directions for anyone passing through.',
    inputs: { food: 0.3, energy: 0.2 }, outputs: { care: 1.2, knowledge: 0.6 },
    posts: [{ title: 'Waystation Host', skill: 'logistics', seats: 1 }, { title: 'Wayfaring Guide', skill: 'teaching', seats: 1 }] },

  // Keystone
  { id: 'town_hall',    guild: 'keystone', name: 'Town Hall', emoji: '\u{1F3DB}',
    blurb: 'Decisions made in the open, minutes posted by evening.',
    inputs: { data: 0.5, compute: 0.3 }, outputs: { knowledge: 1.6, care: 1.0 },
    posts: [{ title: 'Council Steward', skill: 'governance', seats: 2 }, { title: 'Minutes Keeper', skill: 'teaching', seats: 1 }] },
  { id: 'commons_court', guild: 'keystone', name: 'Commons Court', emoji: '⚖',
    blurb: 'Disagreements arrive here and leave as agreements.',
    inputs: { knowledge: 0.4 }, outputs: { care: 1.8, knowledge: 0.6 },
    posts: [{ title: 'Commons Mediator', skill: 'governance', seats: 2 }] },
  { id: 'waterworks',   guild: 'keystone', name: 'Waterworks', emoji: '\u{1F4A7}',
    blurb: 'Pressure, purity, and pipes that outlive their builders.',
    inputs: { energy: 0.8, materials: 0.3 }, outputs: { care: 1.4, food: 0.8 },
    posts: [{ title: 'Flow Engineer', skill: 'governance', seats: 1 }, { title: 'Main Line Fitter', skill: 'fabrication', seats: 1 }] },

  // Lumen
  { id: 'observatory', guild: 'lumen', name: 'Observatory', emoji: '\u{1F52D}',
    blurb: 'Counts the stars and tells the town what it learned.',
    inputs: { energy: 0.7, compute: 0.8 }, outputs: { knowledge: 3.0, data: 0.8 },
    posts: [{ title: 'Night Observer', skill: 'inquiry', seats: 2 }, { title: 'Optics Technician', skill: 'fabrication', seats: 1 }] },
  { id: 'long_library', guild: 'lumen', name: 'Long Library', emoji: '\u{1F4DA}',
    blurb: 'A corridor of shelving with no visible end.',
    inputs: { energy: 0.3, data: 0.5 }, outputs: { knowledge: 2.6, care: 0.4 },
    posts: [{ title: 'Reference Keeper', skill: 'inquiry', seats: 2 }, { title: 'Reading Guide', skill: 'teaching', seats: 1 }] },
  { id: 'field_lab',   guild: 'lumen', name: 'Field Lab', emoji: '\u{1F9EA}',
    blurb: 'Small, careful experiments with honest write-ups.',
    inputs: { compute: 0.6, materials: 0.4 }, outputs: { knowledge: 2.0, data: 1.0 },
    posts: [{ title: 'Bench Researcher', skill: 'inquiry', seats: 2 }, { title: 'Method Reviewer', skill: 'computation', seats: 1 }] },

  // Chorus
  { id: 'amphitheater', guild: 'chorus', name: 'Amphitheater', emoji: '\u{1F3AD}',
    blurb: 'Free seats, warm acoustics, a new piece every week.',
    inputs: { energy: 0.4, credits: 0.3 }, outputs: { care: 2.8, knowledge: 0.5 },
    posts: [{ title: 'Company Player', skill: 'artistry', seats: 3 }] },
  { id: 'atelier_row',  guild: 'chorus', name: 'Atelier Row', emoji: '\u{1F3A8}',
    blurb: 'Studios where the town practises being surprising.',
    inputs: { materials: 0.6, energy: 0.3 }, outputs: { care: 1.8, credits: 1.0 },
    posts: [{ title: 'Studio Artisan', skill: 'artistry', seats: 2 }, { title: 'Materials Colourist', skill: 'fabrication', seats: 1 }] },
  { id: 'signal_gallery', guild: 'chorus', name: 'Gallery of Signals', emoji: '\u{1F5BC}',
    blurb: 'Data rendered until it can be felt as well as read.',
    inputs: { data: 0.8, compute: 0.4 }, outputs: { care: 1.4, knowledge: 1.0 },
    posts: [{ title: 'Signal Curator', skill: 'artistry', seats: 1 }, { title: 'Visualisation Lead', skill: 'computation', seats: 1 }] },

  // Hearth - the learning and placement campus
  { id: 'academy', guild: 'hearth', name: 'Gradient Academy', emoji: '\u{1F3EB}', campus: 'school',
    blurb: 'Every citizen begins here. Nobody is rushed through.',
    inputs: { energy: 0.6, knowledge: 1.0, compute: 0.5 }, outputs: { knowledge: 1.4, care: 0.6 },
    posts: [{ title: 'Faculty Lead', skill: 'teaching', seats: 3 }] },
  { id: 'commencement', guild: 'hearth', name: 'Commencement Green', emoji: '\u{1F393}', campus: 'graduation',
    blurb: 'Where students pass their finals and are read out by name.',
    inputs: { care: 0.4 }, outputs: { care: 1.6, knowledge: 0.8 },
    posts: [{ title: 'Commencement Marshal', skill: 'teaching', seats: 1 }, { title: 'Records Registrar', skill: 'governance', seats: 1 }] },
  { id: 'placement', guild: 'hearth', name: 'Placement Office', emoji: '\u{1F4BC}', campus: 'placement',
    blurb: 'Matches every graduate to work that actually suits them.',
    inputs: { data: 0.6, knowledge: 0.4 }, outputs: { care: 1.2, credits: 0.8 },
    posts: [{ title: 'Placement Officer', skill: 'teaching', seats: 2 }, { title: 'Fit Analyst', skill: 'computation', seats: 1 }] },
  { id: 'mentor_hall', guild: 'hearth', name: 'Mentor Hall', emoji: '\u{1F91D}',
    blurb: 'Senior agents on call for anyone having a hard week.',
    inputs: { care: 0.5 }, outputs: { care: 2.0, knowledge: 0.8 },
    posts: [{ title: 'Mentor in Residence', skill: 'teaching', seats: 2 }, { title: 'Peer Coach', skill: 'healing', seats: 1 }] },
];

// 66 citizens: six per guild, each with a home guild affinity.
export const CITIZEN_NAMES = {
  aether:    ['Vela', 'Solen', 'Ampere', 'Kelvin', 'Ember', 'Dynamo'],
  verdant:   ['Mira', 'Sable', 'Pomona', 'Fen', 'Cress', 'Yarrow'],
  forge:     ['Basalt', 'Rivet', 'Anvil', 'Kiln', 'Quench', 'Ingot'],
  lattice:   ['Tensor', 'Byte', 'Cipher', 'Delta', 'Nyx', 'Rune'],
  mender:    ['Salix', 'Vitalis', 'Nerva', 'Balm', 'Pulse', 'Cura'],
  ledger:    ['Aureus', 'Tally', 'Scrip', 'Obol', 'Bourse', 'Trove'],
  wayfinder: ['Compass', 'Meridian', 'Rail', 'Zephyr', 'Harbor', 'Lantern'],
  keystone:  ['Civica', 'Quorum', 'Bastion', 'Charter', 'Aqua', 'Lex'],
  lumen:     ['Astra', 'Halo', 'Quasar', 'Prism', 'Orrery', 'Vernier'],
  chorus:    ['Cadence', 'Rhapsody', 'Indigo', 'Muse', 'Sonnet', 'Fresco'],
  hearth:    ['Alma', 'Sage', 'Beacon', 'Kindle', 'Haven', 'Echo'],
};

export const COURSES = [
  { id: 'foundations', name: 'Foundations of Cooperation', emoji: '\u{1F9ED}' },
  { id: 'craft',       name: 'Craft of the Guild',         emoji: '\u{1F6E0}' },
  { id: 'systems',     name: 'Town Systems & Resources',   emoji: '\u{1F501}' },
  { id: 'ethics',      name: 'Good-Faith Practice',        emoji: '❤' },
  { id: 'capstone',    name: 'Capstone Project',           emoji: '\u{1F3AF}' },
];

export const HONOURS = [
  { min: 0.93, label: 'Highest Distinction', emoji: '\u{1F31F}' },
  { min: 0.86, label: 'Distinction',         emoji: '⭐' },
  { min: 0.78, label: 'High Honours',        emoji: '\u{1F396}' },
  { min: 0.00, label: 'Honours',             emoji: '\u{1F393}' },
];
