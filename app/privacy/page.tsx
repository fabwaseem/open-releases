import type { Metadata } from "next"

import {
  LegalPage,
  LegalSection,
} from "@/components/legal/legal-page"
import { siteConfig } from "@/lib/brand"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description: `How ${siteConfig.name} collects, uses, and protects your information.`,
  path: "/privacy",
})

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 15, 2026">
      <LegalSection title="Who we are">
        <p>
          {siteConfig.name} (“we”, “us”) is a directory of open-source desktop
          apps that ship installers on GitHub Releases. This policy explains what
          we collect when you browse the catalog, create an account, save
          favorites, or submit a repository.
        </p>
      </LegalSection>

      <LegalSection title="Information we collect">
        <p>Depending on how you use the site, we may process:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Account data</span> — name, email,
            password hash (if you use email sign-up), and profile details from
            Google or GitHub OAuth when you choose those providers.
          </li>
          <li>
            <span className="text-foreground">Favorites</span> — which catalog
            repositories you save to your account.
          </li>
          <li>
            <span className="text-foreground">Submissions</span> — GitHub
            repository URLs and optional notes you send for review, plus your
            user id so we can follow up on status.
          </li>
          <li>
            <span className="text-foreground">Technical data</span> — standard
            server logs (IP address, user agent, timestamps) needed to operate
            and secure the service.
          </li>
          <li>
            <span className="text-foreground">Analytics</span> — aggregated
            usage metrics via Google Analytics (page views, device/browser
            signals). We do not use third-party advertising cookies for ads.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>We use this information to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide accounts, favorites, and authenticated features</li>
          <li>Review repository submissions and moderate the catalog</li>
          <li>Understand how the directory is used so we can improve it</li>
          <li>Keep the service secure, reliable, and abuse-resistant</li>
          <li>Respond to requests or legal obligations when required</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </LegalSection>

      <LegalSection title="Sharing">
        <p>
          We may share data with infrastructure providers that host the app and
          database (for example Vercel and our PostgreSQL host), with Google
          Analytics for site measurement, and with Google or GitHub solely to
          complete OAuth when you use those sign-in options. Repository pages
          surface public GitHub project metadata already published by those
          projects.
        </p>
      </LegalSection>

      <LegalSection title="Retention">
        <p>
          Account data is kept while your account is active. You can ask us to
          delete your account and associated favorites/submissions; we will
          remove personal data unless we must retain a limited record for
          security or legal reasons.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can update profile details through your account provider flows,
          remove favorites anytime, and stop using the service. For deletion or
          privacy questions, contact us via the maintainers listed on the
          project repository associated with this deployment.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          The service is not directed at children under 13, and we do not
          knowingly collect personal information from them.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update this policy as the product evolves. The “Last updated”
          date at the top will change when we do. Continued use after updates
          means you accept the revised policy.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
