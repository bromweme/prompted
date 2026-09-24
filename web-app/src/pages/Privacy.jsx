import { Link } from 'react-router-dom'
import './Privacy.css'

// PRIV-1 Part A.
//
// This page exists because the sign-in screen already told people they were
// agreeing to a privacy policy that did not exist. It describes what the app
// actually does today, checked against the code rather than written from
// intent: the collection list below maps to auth.js, the four PersistentStores,
// events.js and youtube.js.
//
// NOT LEGAL ADVICE. The content is accurate about the app's behaviour; whether
// it is sufficient for any particular jurisdiction is a question for a lawyer.
//
// Named as the project rather than as a person, by the owner's decision.
// Worth knowing what that does and does not do: "controller" normally means a
// legal person — an individual or a registered company — and Prompted is
// neither, so the name identifies the project while the contact address is
// what actually reaches whoever is responsible. That is a reasonable position
// for a side project with no entity behind it. If Prompted is ever
// incorporated, this should become the company's registered name.
//
// The address is published as the route for data-subject requests, so it has
// to stay live and monitored: access, correction and portability arrive here.
// (Erasure does not — that one is self-service in the app.) If it ever stops
// being read, this page starts making a false promise, which is the exact
// thing it was written to remove.
const CONTROLLER = 'Prompted'
const CONTACT_EMAIL = 'prompted.thegame@gmail.com'

const LAST_UPDATED = '23 September 2026'

function Privacy() {
  return (
    <div className="legal-page">
      <main className="legal-content">
        <p className="legal-back">
          <Link to="/">← Back to sign in</Link>
        </p>

        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated {LAST_UPDATED}</p>

        <p>
          Prompted is a game where a group shares YouTube videos against a prompt and
          votes on them. This page explains what the app stores, why, who else sees it,
          and how to get rid of it. It describes what the app actually does — not what
          it might do later.
        </p>

        <h2>Who is responsible</h2>
        <p>
          The data controller is {CONTROLLER}. For anything on this page, including
          requests to see or delete your data, contact <strong>{CONTACT_EMAIL}</strong>.
        </p>

        <h2>What is collected</h2>

        <h3>From your Google account</h3>
        <p>
          Signing in uses Google. Google returns your account identifier, name, email
          address and avatar URL, and the app stores them. The app never sees your Google
          password, and it does not ask Google for anything beyond basic profile details.
          An account with an unverified email address is refused.
        </p>

        <h3>What you create in the app</h3>
        <ul>
          <li>Your display name and chosen avatar</li>
          <li>Groups you create: name, description and settings</li>
          <li>Prompts you write, including ones you share with groupmates</li>
          <li>Videos you submit: the YouTube video id, title and channel</li>
          <li>Your votes, and any comments you leave with them</li>
          <li>Your notifications</li>
        </ul>

        <h3>Technical data</h3>
        <ul>
          <li>
            A sign-in token, stored in your browser, so you stay signed in across
            reconnects. It lasts 30 days. It cannot currently be revoked before it
            expires — signing out removes it from your browser, but does not invalidate
            it server-side.
          </li>
          <li>
            Your IP address is visible to the server while you are connected and may
            appear in its logs.
          </li>
          <li>
            An activity log of things that happen in a game — a round starting, a vote
            being cast. Your identifier is stored in it as a one-way hash, not as your
            account id, and these records are deleted after 12 months.
          </li>
        </ul>

        <h2>Who else receives it</h2>
        <ul>
          <li>
            <strong>Other players.</strong> People in a group see your display name,
            avatar, submissions, scores, and your comments. Prompts you mark as shared
            are offered to people you play with. Nothing is published beyond the groups
            you are in.
          </li>
          <li>
            <strong>Google</strong> — for sign-in, and for video search: when you search
            for a video, your search text is sent to the YouTube Data API.
          </li>
          <li>
            <strong>YouTube</strong> — videos play through <code>youtube-nocookie.com</code>,
            the variant that does not set tracking cookies for playback. Following a link
            out to YouTube itself is an ordinary visit to Google, under their policy.
          </li>
          <li>
            <strong>Hosting and database providers</strong>, who store the data on the
            app's behalf and do not use it for anything else.
          </li>
        </ul>
        <p>
          Nothing is sold. There is no advertising, and no third-party analytics or
          tracking scripts. If that changes, this page changes first, and any
          non-essential tracking will ask before it runs.
        </p>

        <h2>Cookies and local storage</h2>
        <p>
          The app stores your sign-in token in your browser, and remembers small
          interface preferences. Both are strictly necessary for it to work, so there is
          no consent banner. No advertising or analytics cookies are set.
        </p>

        <h2>Why the app is allowed to hold it</h2>
        <p>
          For people in the UK or EU: the app relies on <em>contract</em> for the data it
          needs to give you an account and run a game you joined, and on{' '}
          <em>legitimate interests</em> for keeping the service working and secure —
          including keeping a record of bans, which is the one thing that survives
          account deletion.
        </p>

        <h2>How long it is kept</h2>
        <ul>
          <li>Your account and content: until you delete your account.</li>
          <li>Activity log entries: 12 months.</li>
          <li>Sign-in tokens: 30 days.</li>
          <li>
            Bans: indefinitely, including after account deletion, so that deleting an
            account is not a way back into a group you were removed from.
          </li>
        </ul>

        <h2>Deleting your account</h2>
        <p>
          Account → Delete Account removes your data straight away. Specifically, it:
        </p>
        <ul>
          <li>deletes your profile, your saved prompts and your notifications</li>
          <li>removes you from every group</li>
          <li>
            hands any group you host to its longest-standing remaining member, or deletes
            the group if you were the only one in it
          </li>
          <li>
            detaches your identity from rounds other people played in. Those submissions,
            votes and scores stay, because they are also other players' history, but they
            are no longer linked to you
          </li>
          <li>deletes your entries from the activity log</li>
        </ul>
        <p>
          Two honest caveats. A ban stays in place, as above. And signing in again with
          the same Google account creates a new, empty account rather than restoring the
          old one — there is nothing left to restore.
        </p>

        <h2>Your rights</h2>
        <p>
          In the UK and EU you have the right to access your data, correct it, delete it,
          object to or restrict how it is used, and receive a copy in a portable form.
          You can also complain to your data protection authority — in the UK, the ICO.
        </p>
        <p>
          In California you have the right to know what is collected, to delete it, to
          correct it, and not to be discriminated against for asking. The app does not
          sell or share personal information as those terms are used in the CCPA/CPRA,
          so there is nothing to opt out of.
        </p>
        <p>
          Deleting your account is self-service. For anything else, email{' '}
          <strong>{CONTACT_EMAIL}</strong>.
        </p>

        <h2>Children</h2>
        <p>
          The app is not intended for children under 13, and accounts are not knowingly
          created for them. If you believe a child has an account, email the address
          above and it will be removed.
        </p>

        <h2>Where data is held</h2>
        <p>
          The servers and database are hosted in the United States. If you use the app
          from the UK or EU, your data is transferred there to provide the service.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes, the date at the top changes with it. Substantial
          changes will be announced in the app.
        </p>
      </main>
    </div>
  )
}

export default Privacy
