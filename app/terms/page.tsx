import type { Metadata } from "next"

import {
  LegalPage,
  LegalSection,
} from "@/components/legal/legal-page"
import { siteConfig } from "@/lib/brand"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Terms of Use",
  description: `Terms for using ${siteConfig.name}, the open-source desktop releases directory.`,
  path: "/terms",
})

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="July 15, 2026">
      <LegalSection title="Agreement">
        <p>
          By using {siteConfig.name}, you agree to these terms. If you do not
          agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection title="The service">
        <p>
          {siteConfig.name} indexes publicly available GitHub repository and
          release information so people can discover desktop apps with Windows,
          macOS, and Linux installers. Catalog content may be incomplete, delayed,
          or inaccurate. Always verify downloads on the upstream GitHub project
          before installing software.
        </p>
      </LegalSection>

      <LegalSection title="Accounts">
        <p>
          You are responsible for your account credentials and for activity under
          your account. Provide accurate information. We may suspend or terminate
          accounts that abuse the service, attempt to disrupt it, or violate these
          terms or applicable law.
        </p>
      </LegalSection>

      <LegalSection title="Submissions">
        <p>
          When you submit a repository, you confirm that the project is public
          and that sharing its listing is appropriate. Submissions may be
          accepted, edited, rejected, or removed at our discretion. Listing a
          project does not imply endorsement.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Scrape, overload, or circumvent rate limits or access controls</li>
          <li>Attempt unauthorized access to accounts, admin tools, or data</li>
          <li>
            Use the service to distribute malware or to promote illegal activity
          </li>
          <li>Misrepresent affiliation with {siteConfig.name} or listed projects</li>
        </ul>
      </LegalSection>

      <LegalSection title="Third-party software">
        <p>
          Apps listed in the directory are created and distributed by third
          parties under their own licenses. We are not responsible for those
          applications, their licenses, or harm from downloading or running them.
          Review each project’s license and release notes yourself.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual property">
        <p>
          The {siteConfig.name} name, branding, and site UI are ours (or our
          licensors’). Upstream project names, logos, and release assets remain
          with their respective owners.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer">
        <p>
          The service is provided “as is” without warranties of any kind, express
          or implied, including merchantability, fitness for a particular purpose,
          and non-infringement. We do not warrant uninterrupted or error-free
          operation.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, {siteConfig.name} and its
          operators are not liable for any indirect, incidental, special,
          consequential, or punitive damages, or for lost profits, data, or
          goodwill, arising from your use of the service.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms from time to time. The “Last updated” date
          will change when we do. Continued use after changes constitutes
          acceptance of the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms can be directed to the maintainers of the
          project repository for this deployment.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
