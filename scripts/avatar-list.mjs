// The profile pictures of the story market's accounts (made by `node scripts/make-pictures.mjs --avatars`).
// One for each named account, by its handle (data/sparkPosts.ts), and a pool the made-up-on-the-spot nobodies draw
// from. The owner's rule holds: nothing real. So no faces at all, not even invented ones (a generated face can look
// like somebody): an account's picture is a thing, a pet or a place, the way a great many real accounts' are.
// No writing in a picture; say what IS there.

const LOOK = 'square profile picture, centred subject, simple background, natural light, a little soft, plain unmarked surfaces'

const NAMED = {
  orlavex: 'a vintage silver microphone on a stand lit by purple stage lights',
  kenjiblaze: 'a gaming headset resting on a keyboard glowing blue',
  cheftamsin: 'a copper pan with a flame under it on a professional stove, close up',
  bigmilo: 'a basketball resting on a polished indoor court floor under arena lights',
  profquill: 'a round glass flask of blue liquid beside a feather quill on a cluttered wooden desk',
  daxmarlowe: 'a plain white racing helmet on the bonnet of a racing car in a deserted pit lane',
  globalwire: 'a globe on a desk in dark blue studio light',
  junopark: 'an empty folding canvas chair under a single spotlight on a dark stage',
  critterdispatch: 'a single paw print in wet sand, close up',
  zoomiescentral: 'a happy dog running at full speed across a lawn, ears flying, slightly blurred',
  tinyhatsdaily: 'a tiny knitted bobble hat on a wooden table, close up',
  thenaptimes: 'a cat asleep in a patch of sun on a windowsill',
  wholesomewire: 'a rainbow over a green hill',
  snackgazette: 'a bowl of noodles seen from directly above',
  robotkitchen: 'a small friendly toy robot holding a wooden spoon on a kitchen counter',
  orbitwatch: 'a satellite dish against a starry night sky',
  pixelattic: 'a small figure made of square green tiles on a black wall, like a block-built creature',
  barnyardbulletin: 'a cow looking over the lower half of a red barn door',
  pondreport: 'a frog sitting on a lily pad',
  daybreakcourier: 'a rolled-up newspaper with blank pages on a doorstep at sunrise',
  harborcitypost: 'a lighthouse at the end of a harbour wall at dusk',
  labnotesdigest: 'a microscope on a clean lab bench',
  techlantern: 'a glowing paper lantern in the dark',
  frogposting_daily: 'a small green frog looking straight at the camera, close up',
  the_duck_desk: 'a yellow rubber duck on an office desk',
  ramen_inspector: 'chopsticks lifting noodles out of a bowl, close up',
  retrobits_fm: 'an old portable radio with a long aerial on a shelf',
  bakery_cam: 'croissants on a tray in a bakery window',
  moonwatcher_mae: 'a small telescope pointed at a crescent moon',
  cornershopcats: 'a ginger cat sitting on a shop counter',
  gadget_gran: 'knitting needles and a ball of wool beside a tablet with a dark screen',
  trainspot_otter: 'a river otter looking at a model train on a track',
  goblin_hours: 'a small mossy stone garden gnome lit by a torch at night',
  soupoftheday_: 'a steaming bowl of soup on a wooden table',
  thelastarcade: 'the glowing screen of an old arcade machine showing coloured blocks in a dark room',
  birdatwindow: 'a small bird on a window ledge seen through the glass from indoors',
  unlicensedzoo: 'a hippo yawning, close up',
  smallrobotsdept: 'a row of small wind-up toy robots on a shelf',
  horsegirl_emer: "a horse's nose close up, soft focus",
  midnightsnacks: 'an open fridge glowing in a dark kitchen',
  onegoodpixel: 'a single bright green square in the middle of a plain black background',
  lakesidenews: 'a calm lake with a wooden jetty at sunrise',
  marketandmain: 'an old street corner with a stone clock tower, the clock face plain',
  maplestweekly: 'a single red maple leaf on a wet pavement',
  ferryroadgazette: 'a small ferry boat on calm water',
  northgatecourier: 'a plain red pillar post box on a street corner',
  littleharborherald: 'an old iron anchor on a stone quay',
  pinewooddaily: 'a pine forest in morning mist',
  canalstbulletin: 'a canoe moored on a quiet canal',
  weekend_shipper: 'a wrench lying on a closed laptop on a workbench',
  twodevsonedesk: 'two keyboards side by side on one small desk',
  garagecompiler: 'a red metal toolbox on a garage floor',
  nightlybuildnina: 'a desk lamp lit in a dark room with a crescent moon in the window behind',
  tinkerhouselabs: 'brass gears and a small spanner on a workbench, close up',
  smalltoolsweekly: 'a neat row of tiny screwdrivers on a white table',
  devinbuilds: 'a mug of coffee beside a keyboard in warm evening light',
}

// The nobodies' pictures: the sort of thing a small account uses.
const POOL = [
  'a sleepy tabby cat looking at the camera', 'a small scruffy dog with its head tilted', 'a potted cactus on a windowsill', 'a sunset over the sea', 'a slice of pizza on a paper plate',
  'a mountain peak under a blue sky', 'a pair of worn trainers on a pavement', 'a cup of coffee with foam on a cafe table', 'a goldfish in a round bowl', 'a field of sunflowers',
  'a hamster holding a seed', 'a blurry street at night with coloured lights', 'a houseplant with big green leaves', 'a rubber duck in a bath', 'a slice of toast with jam',
  'a snail on a leaf, close up', 'a pigeon on a railing', 'a full moon in a dark sky', 'a mushroom in moss, close up', 'a bowl of ramen from above',
  'a garden gnome in long grass', 'a single sock on a washing line', 'a teapot on a kitchen table', 'a pretzel on a napkin', 'a small lizard on a warm stone',
  'a ferret peeking out of a blanket', 'a wizard hat on a chair', 'a walnut cracked in half on a table', 'a radish freshly pulled from soil', 'a muffin on a plate',
  'a pebble beach at low tide', 'a foggy road lined with trees', 'a toy dinosaur on a desk', 'a bicycle leaning against a wall', 'a lit candle in a dark room',
  'a waffle with syrup', 'a moth on a lamp shade', 'a bowl of baked beans on toast', 'a badger figurine on a shelf', 'a stack of pancakes with butter',
]

export const AVATARS = [
  ...Object.entries(NAMED).map(([handle, what]) => ({ name: handle, handle, what, look: LOOK })),
  ...POOL.map((what, i) => ({ name: `pool-${i + 1}`, what, look: LOOK })),
]
