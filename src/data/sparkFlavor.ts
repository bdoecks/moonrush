// What makes the story market's timeline read like a timeline: how each named account writes, what it says next,
// what other accounts say about its post, and the replies underneath. All of it is flavour and all of it is INVENTED
// (the same rule as sparkPosts.ts: no real person, outlet, brand or character, and no parody of one). None of it may
// say which coin is the right one, whether a story will run, or whether a post is what it looks like: a line here is
// written from what everybody can already read on the post, never from the simulation's hidden side.

/** How a named account writes, by its handle: all capitals or none, and what it puts before or after a post. */
export const ACCOUNT_STYLE: Record<string, { upper?: boolean; lower?: boolean; pre?: string[]; post?: string[] }> = {
  orlavex: { lower: true, post: [' ✨', ' (i am not okay)', ' love u all', ''] },
  kenjiblaze: { lower: true, post: [' gg', ' W', ' clip it', ''] },
  cheftamsin: { post: [". Chef's kiss.", '. Five stars.', '. Would serve.', ''] },
  bigmilo: { upper: true, post: [' LETS GO', ' 🏀', '', ''] },
  profquill: { pre: ['Fascinating. ', 'For the record: ', 'Peer review pending: ', ''] },
  daxmarlowe: { lower: true, post: [' full send', ' 🏁', ' p1', ''] },
  junopark: { lower: true, post: [' (crying)', ' this is cinema', ' someone option the rights', ''] },
  critterdispatch: { pre: ['DISPATCH: ', 'Critter alert: ', ''] },
  zoomiescentral: { post: [' ZOOM.', ' 💨', ' Zoomies level: maximum.', ''] },
  tinyhatsdaily: { post: [' Hat status: tiny.', ' Hat status: excellent.', ' Hat status: missing, sadly.'] },
  thenaptimes: { post: [' Nap rating: 9/10.', ' Now back to sleep.', ' Do not disturb.', ''] },
  wholesomewire: { pre: ['Some good news: ', 'Your smile for today: ', 'Finally, something nice: ', ''] },
  snackgazette: { post: [' Snack of the day.', ' Would eat. Will not.', ' Crumbs everywhere.', ''] },
  robotkitchen: { post: [' beep.', ' Order up.', ' beep boop.', ''] },
  orbitwatch: { pre: ['Look up: ', 'Tonight: ', 'Sky report: ', ''] },
  pixelattic: { post: [' Press start.', ' 1UP.', ' High score.', ''] },
  barnyardbulletin: { pre: ['From the barn: ', 'Barnyard bulletin: ', ''] },
  pondreport: { pre: ['Pond report: ', 'Live from the pond: ', ''] },
  frogposting_daily: { lower: true, post: [' ribbit', ' 🐸', ''] },
  the_duck_desk: { lower: true, pre: ['duck desk here. ', 'quack. ', ''] },
  ramen_inspector: { lower: true, post: [' inspection passed', ' 9 noodles out of 10', ''] },
  retrobits_fm: { lower: true, post: [' now playing', ' stay tuned', ''] },
  bakery_cam: { lower: true, pre: ['bakery cam caught this: ', ''] },
  moonwatcher_mae: { lower: true, post: [' clear skies', ' 🔭', ''] },
  cornershopcats: { lower: true, post: [' the shop is closed now', ' no refunds', ''] },
  gadget_gran: { pre: ['My grandson showed me this. ', 'Is this the internet? ', ''] },
  trainspot_otter: { lower: true, post: [' on time for once', ' platform 2', ''] },
  goblin_hours: { lower: true, post: [' goblin hours', ' it is 3am', ''] },
  soupoftheday_: { lower: true, post: [' soup of the day', ''] },
  thelastarcade: { lower: true, post: [' one credit left', ' game over', ''] },
  birdatwindow: { lower: true, pre: ['from my window: ', ''] },
  unlicensedzoo: { lower: true, post: [' i am not a vet', ' do not ask how i know', ''] },
  smallrobotsdept: { pre: ['Department notice: ', 'Memo: ', ''] },
  horsegirl_emer: { lower: true, post: [' neigh', ' horse girls stay winning', ''] },
  midnightsnacks: { lower: true, post: [' its 2am', ' snack time', ''] },
  onegoodpixel: { lower: true, post: [' one good pixel', ''] },
}

/** What the account says next about its own post ({N} = the name, as its post gave it). Says nothing about any coin. */
export const FOLLOW_UPS = {
  meme: [
    'update: {N} is fine and has been given a snack', '{N} asked me to tell you all to calm down', 'since everyone is asking: yes, {N} is real', 'more {N} tomorrow. go outside',
    '{N} has seen your replies and remains unbothered', 'we did not expect this many people to care about {N}', 'ok the {N} post got out of hand', '{N} is asleep now. please keep it down',
    'reading every reply about {N}. you are all unwell (affectionate)', 'no i will not be taking questions about {N} at this time', '{N} update in the morning. goodnight',
    'my phone has not stopped since the {N} post', 'to the forty people asking: {N} is doing great',
  ],
  news: [
    'UPDATE: more on {N} as the story develops', 'Our story on {N} is now the most read on the site today', 'We have reached out to {N} for comment', 'A follow-up on {N} runs in tomorrow\'s edition',
    'Readers have sent in {D} photos of {N} so far. Keep them coming.', 'Editor\'s note: yes, the {N} story is real', 'Live blog: everything we know about {N}',
  ],
  tech: [
    'thanks for trying {N}. reading every bug report', '{N} servers are having a morning. hang in there', 'did not expect this many people on the {N} demo', 'changelog for {N} going up tonight',
    'to everyone asking about {N}: there is one site and it is in the post',
  ],
}

/** What another account says when it reposts somebody's post with a line of its own. Says nothing about any coin. */
export const QUOTE_LINES = [
  'this is the best thing i have seen all week', 'ok this one got me', 'everybody look at this right now', 'how is this real', 'i have been staring at this for ten minutes',
  'adding this to the hall of fame', 'the timeline needed this today', 'we talk about this one for years', 'no thoughts. just this', 'i am sending this to everyone i know',
  'whoever posted this, thank you', 'peak. nothing else to say', 'saw this three times already and stopped every time', 'this is why i am still on this app', 'respectfully, obsessed',
  'stop scrolling', 'day improved', 'this is the story of the year and it is not close',
]

/**
 * Replies under a post: nobodies talking, the way a trench timeline does. Some of them repeat what Help says about
 * reading a post (check the handle, read the name twice, misspelled coins lose): never which coin, never how it ends.
 */
export const REPLIES = {
  any: [
    'ticker?', 'ca?', 'who is launching this', 'already a pile of coins on this lol. careful which one', 'sending this to my mum', 'dev do something', 'timeline is cooked today',
    'is this real', 'source?', 'checking the handle before i do anything', 'bundled probably', 'not falling for it this time', 'ok this got me', 'i needed this today', 'we are so back',
    'it is so over', 'first', 'read the name twice before you ape', 'half of these coins are spelled wrong lmao', 'mods??', 'bookmarking this', 'who has the right one',
    'the misspelled ones always die', 'cute but i am not buying anything', 'name a better post. i will wait', 'my portfolio needed this', 'look at the dev bag before anything else',
    'every time i ape the first one i regret it', 'the snipers are already in btw', 'biggest one is not always the right one. learned that twice', 'gm', 'lol', '😭😭😭',
    'ratio', 'how do people find these so fast', 'i was here before it blew up', 'screenshotting this', 'ok but check the risk tag', 'not financial advice but aaaaa',
  ],
  meme: ['protect this one at all costs', 'i would do anything for them', 'crying', 'this is my whole personality now', 'obsessed', 'best account on here', 'more of this please', 'i love it here', 'hall of fame post'],
  news: ['journalism is back', 'finally some real news', 'most important story of the year', 'give them the prize', 'why is this news. (i read all of it)', 'local news stays undefeated', 'reporters eating good today'],
  tech: ['does the demo actually work', 'go try the demos, they are not all the same', 'ship it', 'wen docs', 'site looks rushed', 'tried three of them. try them yourself', 'same name on every coin, the site is the tell'],
  faked: ['lol it was fake', 'told you to check the handle', 'no check mark. every time', 'rip to everyone who aped', 'never trust a screenshot', 'and this is why you read the handle', 'deleted my reply. i fell for it'],
  picked: ['timeline has spoken', 'gg to whoever read it right', 'and the rest go to zero. as usual', 'called it (i did not call it)', 'congrats to the readers'],
  over: ['aaand nobody cared', 'timeline moved on already', 'that was fast', 'on to the next one'],
}

/** What a named account says about itself on its page (by handle). Invented, like the account. */
export const ACCOUNT_BIOS: Record<string, string> = {
  orlavex: 'singer. posts animals with jobs between shows. not financial advice, not any advice',
  kenjiblaze: 'i play games on the internet. chat decides everything',
  cheftamsin: 'Chef. Three restaurants, one opinion: more butter.',
  bigmilo: 'HOOPS. FAMILY. SNACKS. IN THAT ORDER.',
  profquill: 'Professor of things that are probably true. Opinions are peer reviewed by my cat.',
  daxmarlowe: 'driver. fast on sundays, slow on mondays',
  globalwire: 'News from everywhere, as it happens.',
  junopark: 'actor / crier at animal videos',
  critterdispatch: 'Your daily dispatch of critters doing critter things. Submissions open.',
  zoomiescentral: 'All zoomies, all the time. Send us your fastest.',
  tinyhatsdaily: 'One tiny hat a day. Sometimes two.',
  thenaptimes: 'All the naps fit to print.',
  wholesomewire: 'Only the good stuff.',
  snackgazette: 'Reviews of snacks we were not asked to review.',
  robotkitchen: 'A kitchen. Some robots. Mixed results.',
  orbitwatch: 'What is up there tonight.',
  pixelattic: 'Old games, older hardware, zero regrets.',
  barnyardbulletin: 'News from the barn. The goats are fine.',
  pondreport: 'Live from the pond, weather permitting.',
  daybreakcourier: 'Morning news since before you were up.',
  harborcitypost: "The harbor's paper of record.",
  labnotesdigest: 'Science, briefly.',
  techlantern: 'A light on what is being built.',
  frogposting_daily: 'one frog a day until morale improves',
  the_duck_desk: 'the duck desk. we cover ducks',
  ramen_inspector: 'inspecting ramen so you do not have to. i will anyway',
  retrobits_fm: 'broadcasting from a basement full of cartridges',
  bakery_cam: 'a camera pointed at a bakery. that is the whole account',
  moonwatcher_mae: 'i look up a lot',
  cornershopcats: 'cats of the corner shop. they do not work here. they run it',
  gadget_gran: 'Grandmother of six. I review gadgets my grandchildren leave here.',
  trainspot_otter: 'trains and otters. occasionally both',
  goblin_hours: 'awake at the wrong times',
  soupoftheday_: 'today: soup',
  thelastarcade: 'keeping one arcade alive',
  birdatwindow: 'there is a bird at my window. updates as they come',
  unlicensedzoo: 'not a zoo. not licensed. do not ask',
  smallrobotsdept: 'Department of Small Robots. Office hours: whenever they work.',
  horsegirl_emer: 'horse girl (retired)',
  midnightsnacks: 'the club meets at midnight. bring snacks',
  onegoodpixel: 'looking for one good pixel',
  lakesidenews: 'Lakeside News Now: local, live, lakeside.',
  marketandmain: 'Business and town news from the corner of Market and Main.',
  maplestweekly: 'Your street. Weekly.',
  ferryroadgazette: 'Covering Ferry Road and the roads off it.',
  northgatecourier: 'Northgate news, delivered.',
  littleharborherald: 'All the news from Little Harbor.',
  pinewooddaily: 'Pinewood, daily.',
  canalstbulletin: 'Posted on Canal Street.',
  weekend_shipper: 'shipping small things on weekends',
  twodevsonedesk: 'two devs. one desk. many arguments',
  garagecompiler: 'building in the garage',
  nightlybuildnina: 'i ship at night',
  tinkerhouselabs: 'Small tools, built in the open.',
  smalltoolsweekly: 'A small tool every week.',
  devinbuilds: 'I build small useful things and write about them.',
}
