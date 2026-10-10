// The story market's picture list (made by scripts/make-pictures.mjs). About 300: three plain pictures of everything a
// post can be about, and one for each of the happenings that are funniest to see. Each entry says what the picture
// goes with: `word` is the post's subject (data/sparkPosts.ts SUBJECTS) and `did`, when there is one, is the exact
// happening (DID there), so the game can find the picture of "the otter who was promoted to station master".
// The owner's rule: nothing real (no person, brand, place, famous animal or character) and no writing in a picture.
// What was learned on the test batch (2026-10-10): say what IS there ("an empty hall"; "no people" draws people),
// never say "phone" (the cheaper model draws a hand holding one), and give a gadget an invented shape.

const SNAP = 'amateur snapshot by a passer-by, ordinary daylight, slightly off-centre, a little soft, quiet empty surroundings, plain unmarked surfaces'
const PAPER = 'local newspaper photo, on-camera flash, slightly grainy, an empty room behind, plain unmarked surfaces'

// What each subject looks like in a photo, and what kind of place it is found in.
const CREATURES = {
  dog: 'a scruffy mongrel dog', puppy: 'a small fluffy puppy', fox: 'a red fox', wolf: 'a grey wolf', cat: 'a tabby cat', kitten: 'a tiny grey kitten', tiger: 'a tiger',
  lion: 'a lion with a full mane', frog: 'a green frog', toad: 'a warty brown toad', turtle: 'a tortoise', lizard: 'a small green lizard', horse: 'a chestnut horse',
  squirrel: 'a red squirrel', monkey: 'a small brown monkey', bear: 'a brown bear', owl: 'a tawny owl', duck: 'a mallard duck', penguin: 'a penguin', hamster: 'a golden hamster',
  rabbit: 'a large lop-eared rabbit', panda: 'a giant panda', shark: 'a small shark', whale: 'a whale', crab: 'an orange crab', snail: 'a garden snail', goat: 'a white goat',
  cow: 'a black and white cow', pig: 'a pink pig', chicken: 'a brown hen', hippo: 'a small hippo', beaver: 'a beaver', otter: 'a river otter', sloth: 'a sloth', koala: 'a koala',
  dragon: 'a small scaly green dragon the size of a cat', unicorn: 'a small white pony with a single spiral horn', bird: 'a small garden robin', bull: 'a large brown bull',
  fish: 'a goldfish', mink: 'a dark brown mink', worm: 'an earthworm',
}
const TINY = ['frog', 'toad', 'lizard', 'hamster', 'crab', 'snail', 'worm', 'bird']
const LAND = ['sitting on the front doorstep of a brick house', 'standing in a kitchen looking up at the camera', 'sitting on a park bench', 'on a sofa in a living room', 'in the aisle of an empty corner shop with plain shelves', 'on the pavement outside a bakery window']
const SMALL = ['on a kitchen windowsill next to a plain mug', 'on a garden path seen from close up', 'on the edge of a wooden desk beside a plain notebook']
const SEA = ['seen from a wooden pier in calm clear water', 'surfacing beside a small empty rowing boat', 'in shallow water off an empty beach']
const BOWL = ['in a round glass bowl on a kitchen table', 'in a garden pond seen from above', 'in a clear tank on an office desk']
const FOODS = {
  pizza: 'a whole pizza', burger: 'a burger', taco: 'a taco', banana: 'a single banana', cookie: 'a large cookie', donut: 'a glazed donut', pickle: 'a single pickle', cheese: 'a wedge of cheese',
  cake: 'a home-made iced cake', waffle: 'a waffle', pancake: 'a stack of pancakes', mango: 'a mango', peach: 'a peach', lemon: 'a lemon', melon: 'a melon', egg: 'a boiled egg in an egg cup',
  toast: 'a slice of buttered toast', dumpling: 'a single steamed dumpling',
}
const TABLE = ['on a plate on a kitchen counter', 'on a cafe table by a window', 'in an open plain cardboard box on an office desk']
const THINGS = {
  robot: ['a small wheeled household robot with two round eye lights', ['in a hallway', 'on a kitchen floor', 'on a garden patio']],
  bot: ['a small boxy six-wheeled delivery robot', ['on an empty pavement', 'outside a front door', 'in an empty lobby']],
  android: ['a knee-high white plastic humanoid toy robot, clearly a machine', ['standing on a coffee table', 'on a workshop bench', 'beside a bookshelf']],
  machine: ['an old boxy grey machine with dials and one blinking green light', ['in a garage', 'on a workshop table', 'in the corner of an empty office']],
  rocket: ['a small home-built model rocket', ['standing on a stand in a field', 'on a garage workbench', 'lifting off from a field with a trail of smoke']],
  comet: ['a comet with a faint tail in the night sky', ['above the roofs of a quiet street', 'above a garden fence', 'above a dark hill']],
  alien: ['a small grey-green rubbery alien creature with large dark eyes', ['sitting on a garden chair at dusk', 'standing in a field at dusk', 'peering round a garden shed at dusk']],
  ufo: ['a blurry disc-shaped light in the dusk sky', ['above rooftops', 'above an empty field', 'above a row of trees']],
  planet: ['a bright ringed planet seen through the eyepiece of a backyard telescope, round view on black', ['', '', '']],
  arcade: ['an old upright arcade cabinet of an invented design with blank side panels and a screen of coloured blocks', ['in a garage', 'in the corner of a launderette', 'in a hallway']],
  cartridge: ['a grey plastic game cartridge with a blank label', ['on a wooden desk', 'held up against a window', 'on a carpet']],
  console: ['an old boxy home games console of an invented design, beige with two round buttons and a glowing green light', ['on a carpet', 'on a shelf', 'in an open plain cardboard box']],
  joystick: ['an old chunky joystick with one red button, of an invented design', ['on a wooden desk', 'on a carpet', 'on a windowsill']],
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44)
const plain = []
Object.entries(CREATURES).forEach(([word, what], i) => {
  const places = word === 'fish' ? BOWL : word === 'shark' || word === 'whale' ? SEA : TINY.includes(word) ? SMALL : [LAND[i % 6], LAND[(i + 2) % 6], LAND[(i + 4) % 6]]
  places.forEach((p, k) => plain.push({ name: `${word}-${'abc'[k]}`, word, what: `${what} ${p}`, look: SNAP }))
})
Object.entries(FOODS).forEach(([word, what]) => TABLE.forEach((p, k) => plain.push({ name: `${word}-${'abc'[k]}`, word, what: `${what} ${p}`, look: SNAP })))
Object.entries(THINGS).forEach(([word, [what, places]]) => places.forEach((p, k) => plain.push({ name: `${word}-${'abc'[k]}`, word, what: `${what} ${p}`.trim(), look: SNAP })))

// The test batch (made 2026-10-10; the names are kept so nothing is made twice).
const FIRST = [
  ['otter-station-master', 'otter', 'was promoted to station master', 'a river otter wearing a small plain navy cap, sitting on a bench on an empty train platform'],
  ['sloth-counts', 'sloth', null, 'a sloth sitting at a wooden table looking at a row of apples', PAPER],
  ['duck-library', 'duck', 'waited outside the library until it opened', 'a duck standing on the counter of an empty public library next to a stack of books'],
  ['dog-bus', 'dog', 'rode the bus alone again this morning', 'a scruffy dog sitting alone on a seat of an empty city bus, looking out of the window'],
  ['cat-salad-bowl', 'cat', 'fell asleep in a salad bowl', 'a cat curled up asleep inside a large salad bowl on a kitchen counter'],
  ['hippo-hot-tub', 'hippo', 'refused to leave the hot tub', 'a small hippo sitting in an outdoor hot tub in a back garden, looking content'],
  ['frog-backwards', 'frog', 'only walks backwards now', 'a green frog on a garden path seen from behind, mid-step'],
  ['penguin-pool', 'penguin', 'refused to get out of the pool at closing time', 'a penguin standing at the edge of an empty indoor swimming pool at dusk'],
  ['horse-shoes', 'horse', 'keeps bringing home shoes that are not his', 'a horse in a stable doorway with a pile of mismatched human shoes on the straw beside it'],
  ['goat-meeting', 'goat', 'sat like a person through an entire meeting', 'a goat sitting upright on an office chair at an empty meeting table', PAPER],
  ['squirrel-fridge', 'squirrel', 'learned to open the fridge', 'a squirrel perched on the shelf of an open fridge in a kitchen'],
  ['bear-traffic-cone', 'bear', 'adopted a traffic cone', 'a small bear cub hugging an orange traffic cone on a quiet empty road'],
  ['owl-fire-station', 'owl', null, 'an owl perched on the bumper of a fire engine inside an empty fire station', PAPER],
  ['pig-shopping-cart', 'pig', 'sat in a shopping cart and demanded to be pushed', 'a pig sitting in a shopping cart in an empty supermarket car park'],
  ['koala-fountain', 'koala', 'fell in the fountain and acted like it was on purpose', 'a wet koala sitting on the edge of a town square fountain, looking unbothered'],
  ['pancake-worried', 'pancake', 'came out of the oven looking worried', 'a pancake on a plate with a worried face made of blueberries, in a staff kitchen'],
  ['pizza-counter', 'pizza', 'has been on the counter for nine days and nobody dares eat it', 'a whole pizza sitting untouched on a kitchen counter with a small paper crown on it'],
  ['robot-stuck-chair', 'robot', 'got stuck under the same chair for the third time', 'a small round robot vacuum wedged under a wooden dining chair'],
  ['robot-crosswalk', 'bot', 'waited politely at a crosswalk for an hour', 'a small boxy delivery robot waiting at the kerb of an empty pedestrian crossing'],
  ['console-attic', 'console', 'was found in an attic still in the box', 'a dusty grey retro games console in an open cardboard box in an attic, lit by a torch'],
].map(([name, word, did, what, look]) => ({ name, word, ...(did ? { did } : {}), what, look: look ?? 'amateur phone photo taken by a passer-by, ordinary daylight, slightly off-centre, a little soft, quiet empty surroundings, plain unmarked surfaces' }))

// One happening, one picture: [subject, the happening exactly as DID has it, what is in the picture, the look].
const SCENES = [
  // (Second goes at four of the test batch: a proper peaked cap, nobody at the edge, an invented console.)
  ['otter', 'was promoted to station master', 'a river otter wearing a small plain peaked railway cap with a flat top and a stiff shiny brim, sitting upright on a bench on an empty train platform', SNAP, 'otter-station-master-2'],
  ['dog', 'rode the bus alone again this morning', 'a scruffy dog sitting alone on a seat near the window of a completely empty city bus, rows of empty seats behind', SNAP, 'dog-bus-2'],
  ['koala', 'fell in the fountain and acted like it was on purpose', 'a wet koala sitting on the stone edge of a fountain in an empty town square at dawn, looking unbothered', SNAP, 'koala-fountain-2'],
  ['console', 'was found in an attic still in the box', 'an old boxy beige home games console of an invented design with two round buttons, in an open plain cardboard box in a dusty attic', SNAP, 'console-attic-2'],
  ['fox', 'stole a whole pizza and showed no remorse', 'a red fox trotting down an empty pavement carrying a whole pizza in its mouth'],
  ['duck', 'showed up at the same bakery at 9am sharp', 'a mallard duck standing at the glass door of a closed bakery, looking in'],
  ['hamster', 'wore a tiny hat to work', 'a golden hamster wearing a tiny knitted hat, sitting on an office desk beside a plain mug'],
  ['goat', 'escaped twice this week', 'a white goat standing on the roof of a parked car in a farmyard'],
  ['chicken', 'started wearing boots', 'a brown hen wearing two tiny red rubber boots in a muddy yard'],
  ['owl', 'won a staring contest with a security camera', 'a tawny owl perched on a wall staring straight into a small security camera a few inches away'],
  ['cow', 'held up traffic for forty minutes and was thanked for it', 'a black and white cow lying down in the middle of an empty country road'],
  ['cat', 'figured out the elevator', 'a tabby cat sitting inside an open empty lift with plain steel walls, looking out'],
  ['dog', 'attended a wedding and caught the bouquet', 'a scruffy dog on a lawn holding a flower bouquet in its mouth, rows of empty white chairs behind'],
  ['pig', 'got banned from the buffet', 'a pink pig with its front trotters up on an empty buffet table of covered steel dishes', PAPER],
  ['cat', 'stood in the rain looking betrayed', 'a soaked tabby cat standing in the rain on a doorstep, looking up at the camera'],
  ['dog', 'finished a 5k by accident', 'a muddy scruffy dog running through a plain ribbon stretched across an empty park path'],
  ['penguin', 'walked into a pharmacy and waited in line', 'a penguin standing in the aisle of an empty chemist shop with plain shelves'],
  ['sloth', 'was found asleep on the photocopier', 'a sloth asleep on top of an office photocopier in an empty office', PAPER],
  ['turtle', 'has been sitting on the same bench every day since march', 'a tortoise sitting in the middle of a park bench under a tree'],
  ['dog', 'chased a drone for two miles', 'a scruffy dog running across a field looking up at a small drone in the sky'],
  ['rabbit', 'took the last seat on the train and would not move', 'a large lop-eared rabbit sitting on a seat in an empty train carriage'],
  ['fox', 'was caught on the doorbell camera stealing a parcel', 'a red fox carrying a small plain cardboard parcel off a porch at night, wide-angle view from above the door, slightly grainy, porch light'],
  ['dog', 'carried a stick too wide for the gate for ten minutes', 'a scruffy dog holding a very long stick sideways in its mouth, stuck at a narrow garden gate'],
  ['cat', 'walked through wet cement and left a signature', 'a tabby cat sitting beside a trail of paw prints in fresh wet cement on a pavement'],
  ['cat', 'went viral for the face made at the vet', 'a tabby cat on a steel examination table with a deeply unimpressed expression', PAPER],
  ['dog', 'pressed the crosswalk button and waited', 'a scruffy dog sitting at an empty pedestrian crossing with one paw up on the button post'],
  ['cat', 'has been greeting commuters every morning for a year', 'a tabby cat sitting on top of a ticket barrier in an empty station hall'],
  ['cat', 'learned to ring the doorbell', 'a tabby cat stretching up with one paw on a doorbell beside a front door'],
  ['goat', 'got loose at the garden centre', 'a white goat standing among rows of potted plants in an empty garden centre, eating a flower'],
  ['goat', 'stood on a roof for six hours for no reason', 'a white goat standing on the ridge of a house roof against a grey sky'],
  ['cat', 'brought a leaf to the shop as payment', 'a tabby cat sitting on a shop counter with a single leaf laid in front of it'],
  ['dog', 'ignored a very expensive bed to sleep in the box', 'a scruffy dog curled up asleep in a plain cardboard box next to an untouched plush pet bed'],
  ['duck', 'queued for ice cream alone', 'a mallard duck standing at the closed serving window of a small plain ice cream kiosk'],
  ['goat', 'screamed at a pumpkin', 'a white goat with its mouth wide open facing a large pumpkin in a field'],
  ['cow', 'got stuck in a fence and looked proud of it', 'a black and white cow with its head through a wooden fence, looking pleased'],
  ['fox', 'walked a full lap of the stadium during the match', 'a red fox trotting along the running track of an empty stadium'],
  ['bear', 'refused to leave the hot tub', 'a brown bear sitting in an outdoor hot tub on a wooden deck, looking relaxed'],
  ['monkey', 'learned to open the fridge', 'a small brown monkey sitting in front of an open fridge in a kitchen'],
  ['penguin', 'rode the bus alone again this morning', 'a penguin standing on a seat of a completely empty city bus'],
  ['panda', 'fell asleep in a salad bowl', 'a panda cub asleep in a very large wooden bowl of green leaves'],
  ['lizard', 'wore a tiny hat to work', 'a small green lizard wearing a tiny paper party hat on a wooden desk'],
  ['pig', 'escaped twice this week', 'a pink pig trotting down an empty village lane'],
  ['duck', 'started wearing boots', 'a mallard duck wearing two tiny yellow rubber boots beside a puddle'],
  ['beaver', 'adopted a traffic cone', 'a beaver dragging an orange traffic cone along a riverbank'],
  ['horse', 'stood in the rain looking betrayed', 'a wet chestnut horse standing in a field in heavy rain, staring at the camera'],
  ['hippo', 'sat in a shopping cart and demanded to be pushed', 'a baby hippo sitting in a shopping cart in an empty car park'],
  ['owl', 'was found asleep on the photocopier', 'a tawny owl asleep on top of an office photocopier in an empty office', PAPER],
  ['koala', 'took the last seat on the train and would not move', 'a koala clinging to the headrest of a seat in an empty train carriage'],
  ['squirrel', 'was caught on the doorbell camera stealing a parcel', 'a red squirrel dragging a very small plain parcel across a doormat, wide-angle view from above the door'],
  ['bull', 'held up traffic for forty minutes and was thanked for it', 'a large brown bull standing calmly in the middle of an empty village crossroads'],
  ['snail', 'finished a 5k by accident', 'a garden snail crossing a white painted line on an empty running track, seen from close up'],
  // Food.
  ['cookie', 'has a face now and we are all responsible', 'a large cookie with a smiling face piped in icing, on a plate on a kitchen counter'],
  ['cake', 'won first prize and looked smug about it', 'a home-made iced cake on a trestle table in a village hall with a plain blue rosette beside it', PAPER],
  ['burger', 'got its own chair at the dinner table', 'a burger sitting on the seat of a dining chair pulled up to a set dinner table'],
  ['donut', 'survived the office party untouched', 'a single glazed donut left on a tray on an office desk among empty paper cups'],
  ['dumpling', 'is somehow still warm', 'a single steaming dumpling on a small plate on a kitchen counter'],
  ['toast', 'fell on the floor and landed perfectly', 'a slice of buttered toast standing upright on its edge on a kitchen floor'],
  ['cake', 'was too pretty to cut so now it lives here', 'an elaborately decorated cake under a glass dome on a bookshelf'],
  ['melon', 'has been in the staff fridge since january', 'a lone melon on a shelf in an otherwise empty office fridge'],
  ['taco', 'was left on the bus and returned by a stranger', 'a taco sitting alone on a seat of an empty bus'],
  ['cheese', 'got a standing ovation at the fair', 'a huge wheel of cheese on a trestle table in an empty marquee', PAPER],
  // Robots.
  ['robot', 'apologised to the cat', 'a small wheeled household robot with two round eye lights facing a tabby cat on a living room floor'],
  ['robot', 'started a group chat with the toaster', 'a small household robot with two round eye lights on a kitchen counter next to a plain steel toaster'],
  ['bot', 'got lost in the car park and asked a pigeon for help', 'a small boxy six-wheeled delivery robot in an empty car park facing a pigeon'],
  ['android', 'said good morning to a lamp', 'a knee-high white plastic humanoid toy robot looking up at a floor lamp in a living room'],
  ['robot', 'took the stairs and regretted it', 'a small wheeled household robot tipped on its side at the bottom of a staircase'],
  ['machine', 'was given a name tag and has not stopped looking at it', 'an old boxy grey machine with dials and a blank white sticker on its front, in a workshop'],
  // Space.
  ['ufo', 'was spotted again last night and nobody can explain it', 'a blurry disc-shaped light in the dusk sky above the roofs of a quiet street, slightly shaky'],
  ['comet', 'was photographed from a back garden with a phone', 'a comet with a faint tail in the night sky above a garden fence and a washing line, slightly grainy'],
  ['planet', 'is brighter tonight than it has been all year', 'a very bright planet low in the evening sky above a row of chimneys'],
  ['alien', 'waved back', 'a small grey-green rubbery alien creature with large dark eyes raising one hand, standing in a field at dusk'],
  // Retro.
  ['console', 'still boots up after thirty years', 'an old boxy beige home games console of an invented design with a glowing green light, on a carpet in front of a bulky old television showing a plain blue screen'],
  ['cartridge', 'was found at a garage sale for two dollars', 'a grey plastic game cartridge with a blank label on a folding table among old household odds and ends'],
  ['arcade', 'works perfectly if you hit it once on the left', 'an old upright arcade cabinet of an invented design with blank side panels and a screen of coloured blocks, in a garage'],
  ['joystick', 'was fixed by a twelve-year-old with a hairpin', 'an old chunky joystick with one red button on a wooden desk, a hairpin lying beside it'],
].map(([word, did, what, look, name]) => ({ name: name ?? `${word}--${slug(did)}`, word, did, what, look: look ?? SNAP }))

export const LIST = [...FIRST, ...SCENES, ...plain]
