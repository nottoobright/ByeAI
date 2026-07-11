# Privacy Policy for ByeAI

**Last Updated:** July 12, 2025

Thank you for using ByeAI ("we", "us", "our"). We are committed to protecting your privacy. This Privacy Policy explains what information we collect, how we use it, and your choices regarding your information. Our guiding principle is to collect the minimum data necessary to operate our service effectively and anonymously.

### Information We Collect

To provide a community-based filtering service, we collect a limited amount of non-personally identifiable information when you flag a video:

*   **Anonymous User Hash (`clientHash`):** When you first install the extension, a single, randomly generated 128-bit UUID is created and stored locally on your computer. This hash is sent with your votes to prevent duplicate voting and to anonymously track reputation. It is not linked to your identity in any way.
*   **Vote Data:** When you flag a video, we collect the YouTube Video ID, the category you selected (e.g., "AI-script"), the timestamp, and the video's view count.
*   **No Personal Data:** We **do not** collect, store, or have access to your IP address, email address, name, or YouTube browsing history.

### How We Use Information

The anonymous data we collect is used exclusively to:

*   Calculate a community "score" for each flagged video.
*   Determine if a video's score has met the threshold to be hidden for all ByeAI users.
*   Anonymously adjust the reputation of the `clientHash` based on community consensus.

### Opt-In Analytics

We use a self-hosted instance of Plausible Analytics, a privacy-focused analytics platform, to understand how our extension is used. This is **strictly opt-in**. If you do not enable it in the settings, no analytics data is collected.

If you opt-in, we collect anonymous, aggregate data such as the number of votes cast and which categories are most popular. This helps us improve the service. You can view Plausible's data policy [here](https://plausible.io/data-policy).

### Data Sharing and Open Source

In the spirit of transparency and open source, we may periodically publish anonymized dumps of the vote data. This data will not contain any `clientHash` identifiers.

### Data Security

We are committed to protecting your information and use standard security measures to protect our servers and database.

### Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page.

### Data Retention

Votes, video scores, and anonymous reputation data are retained indefinitely while the service operates — they form the community consensus dataset. The anonymous client identifier (a random UUID) exists only in your browser and can be reset at any time by clearing the extension's storage or reinstalling it. Standard web-server access logs (which include IP addresses) are rotated and deleted within 14 days. If the ByeAI service shuts down, the entire server database will be deleted within 30 days.

### Contact Us

If you have any questions about this Privacy Policy, please contact us at: **support@byeai.club**
