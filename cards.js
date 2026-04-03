// ============================================================
//  CUSTOMIZE YOUR CARDS HERE
//  Change the title, message, and iconType for each card!
//  Available iconType values: heart | star | smile | moon | feather | flame
//
//  PHOTO: photos/1pic.jpg → photos/7pic.jpg
//         Place your photos inside the "photos/" folder next to index.html.
//         Set photo: null to use no photo (dark gradient background).
// ============================================================

const CARDS_DATA = [
  {
    id: 1,
    year: "Message 1",
    theme: "The Moment I Fell",
    iconType: "star",
    color: "#D4A843",
    glowColor: "rgba(212, 168, 67, 0.4)",
    title: "How I Fell For You",
    message: "I didn't plan it. I didn't see it coming. But somewhere between the first time I heard you laugh and the first time you looked at me — really looked at me — I was already gone. It wasn't dramatic. It was quiet, like breathing. Like it was always supposed to happen. I fell for you, and I'd fall again every single time.",
    scratchColor: "#B8912E",
    photo: "photos/1pic.jpg"
  },
  {
    id: 2,
    year: "Message 2",
    theme: "The Hard Parts",
    iconType: "heart",
    color: "#4A9B6F",
    glowColor: "rgba(74, 155, 111, 0.4)",
    title: "Even When We Fight",
    message: "We've had our arguments. The ones where we both said things we didn't mean, where the silence felt heavier than the words. But here's what I learned — I'd rather fight with you and work through it than have peace with anyone else. Every time we found our way back to each other, I loved you a little more than before.",
    scratchColor: "#357A54",
    photo: "photos/2pic.jpg"
  },
  {
    id: 3,
    year: "Message 3",
    theme: "The Little Things",
    iconType: "smile",
    color: "#4A7FB5",
    glowColor: "rgba(74, 127, 181, 0.4)",
    title: "What I Notice About You",
    message: "It's the little things. The way you get excited over the smallest stuff and your whole face changes. The way you say our callsign. The random things you say that somehow always make me smile. You don't even realize how much of my day you take up — and I wouldn't have it any other way.",
    scratchColor: "#355E8A",
    photo: "photos/3pic.jpg"
  },
  {
    id: 4,
    year: "Message 4",
    theme: "My Favorite You",
    iconType: "moon",
    color: "#8B5CF6",
    glowColor: "rgba(139, 92, 246, 0.4)",
    title: "Every Version of You",
    message: "My favorite version of you is the one who gets so excited about a good bowl of soup, the loud one when you’re happy, and the soft one when it’s just us. The one who’s stubborn, and the one who’s gentle. I’ve seen so many sides of you and I love every single one. There’s no version of you I wouldn’t choose.",
    scratchColor: "#6D40C4",
    photo: "photos/4pic.jpg"
  },
  {
    id: 5,
    year: "Message 5",
    theme: "What I Never Said Enough",
    iconType: "feather",
    color: "#9CA3AF",
    glowColor: "rgba(156, 163, 175, 0.3)",
    title: "Thank You",
    message: "Thank you. For the days you stayed when it was hard. For choosing me even when I made it difficult. For the patience you gave me when I didn't deserve it. For the love you showed up with consistently, quietly, without asking for anything in return. You've been more than I ever asked for — and more than I thought I'd get.",
    scratchColor: "#6B7280",
    photo: "photos/5pic.jpg"
  },
  {
    id: 6,
    year: "Message 6",
    theme: "Still Falling",
    iconType: "flame",
    color: "#E05D6E",
    glowColor: "rgba(224, 93, 110, 0.5)",
    title: "I'm Still Falling For You",
    message: "I have been falling for you since the beginning — and it hasn't stopped. It hasn't slowed down. If anything, it's deeper now, more certain, more real. I don't just love you because of everything we've been through. I love you because of who you are, right now, today. And I want you. Not just for a season — forever. You're it for me.",
    scratchColor: "#B8394A",
    photo: "photos/6pic.jpg"
  }
];

// ============================================================
//  FINALE SECRET MESSAGE — scratched on the final screen
// ============================================================
const FINALE_MESSAGE = "We're not done yet. We're just getting started. I don't know everything that's ahead — but I know I want every memory, every moment, every adventure to be with you. We will make so many more memories together, I promise. Here's to everything still to come.";