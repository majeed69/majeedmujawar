/*
  config.js
  =========

  This is the only file you should ever need to edit.

  Everything on the page that is about you (your links, your projects, your
  answers to recruiter questions) is read from here when the page loads.

  A few simple rules keep it safe to edit:

  1. Every piece of text sits inside double quotes, like "this".
  2. Every line inside a list or a group ends with a comma, except that a
     trailing comma after the last item is fine too.
  3. If you want an apostrophe inside your text, you can type a normal one
     (') and the page will turn it into a curly one (’) for you.
  4. Do not use long dashes in your text. Use a comma or a full stop instead.
  5. After saving, refresh the page. If something you added does not show up,
     open the browser console (right click, Inspect, Console). The page will
     tell you there, in plain words, what it could not understand.

  Lines that start with // are notes for you. The page ignores them.
*/

window.SITE_CONFIG = {

  // The address where your site lives, ending with a slash.
  // On GitHub Pages this is usually https://YOUR-USERNAME.github.io/
  // If you later buy a domain, put it here, for example "https://majeed.dev/".
  siteUrl: "https://majeed69.github.io/majeedmujawar/",

  // Your full name, as you want it to appear.
  name: "Majeed Mujawar",

  // Your email address. Used by the Email, Copy email and postcard buttons.
  email: "majeedmujawar69@gmail.com",

  // Your GitHub username only (not the full link).
  // Used for "last pushed code" and the "Everything else on GitHub" button.
  github: "majeed69",

  // A link to your resume PDF, for example a Google Drive share link,
  // or "assets/resume.pdf" if you upload the file into the assets folder.
  // Leave it as "" (empty quotes) to hide the Download resume button.
  resume: "",

  // Your projects. Each line is a link to a GitHub repository.
  // To add a project: paste its GitHub link on a new line. That's it.
  // The name, description, language and tags are fetched from GitHub,
  // so keep the description and topics on GitHub itself up to date.
  // Projects appear in the same order as this list.
  projects: [
    "https://github.com/majeed69/whatthehttp",
    "https://github.com/majeed69/Bloktra"
  ],

  // Your social links, shown at the bottom of the page and in the
  // shortcuts menu. Each line is ["Name shown on the page", "link"].
  // To hide one without deleting it, make its link empty: ["Medium", ""].
  socials: [
    ["LinkedIn", "https://in.linkedin.com/in/majeedmujawar"],
    ["GitHub",   "https://github.com/majeed69"],
    ["Medium",   "https://medium.com/@majeedmujawar"],
    ["X",        "https://x.com/majeedmujawar01"],
    ["Credly",   "https://www.credly.com/users/majeedmujawar"]
  ],

  // What you are learning right now, shown in the "Right now" section.
  // The first item is shown as "learning", the rest as "also learning".
  learning: ["Kubernetes", "Ruby on Rails", "cloud security"],

  // Your answers to the questions recruiters usually ask.
  // Anything you put inside [square brackets] is shown with a yellow
  // highlight, so you can spot answers you have not finished yet.
  // Remove the brackets once the answer is final.
  answers: {
    roles:    "Cloud, DevOps and technical support roles, especially at SaaS companies. I’m also happy to work on data and automation.",
    workMode: "All three work for me.",
    relocate: "Yes, I’m open to relocating.",
    start:    "Immediately."
  }
};
