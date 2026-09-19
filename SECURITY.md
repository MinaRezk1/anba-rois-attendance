# Security note

The current UI uses a client-side servant PIN flow. Firestore is also configured with open read/write rules for the existing app documents.

Do not use this deployment for sensitive or production data until server-enforced authentication/authorization is added (for example Firebase Authentication plus role-aware Firestore Security Rules).
