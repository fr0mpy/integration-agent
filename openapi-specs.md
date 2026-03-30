# OpenAPI Specs for Testing

Popular, real-world APIs with API key / bearer token auth (no OAuth flows required).

| API | What it does | Auth | Spec URL |
|-----|-------------|------|----------|
| **Petstore** | Classic demo REST API | API Key | `https://petstore3.swagger.io/api/v3/openapi.json` |
| **Stripe** | Payments & billing | API Key (Bearer) | `https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json` |
| **Resend** | Email sending API | API Key (Bearer) | `https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml` |
| **SendGrid** | Email delivery platform | API Key (Bearer) | `https://raw.githubusercontent.com/twilio/sendgrid-oai/main/oai.json` |
| **TMDB** | Movie & TV database | API Key (query param) | `https://developer.themoviedb.org/openapi/64542913e1f86100738e227f` |
| **PagerDuty** | Incident response & on-call | API Key | `https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json` |
| **Twilio** | SMS, voice, comms | API Key | `https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json` |
| **Slack** | Team messaging | Bot Token (Bearer) | `https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json` |
| **GitHub** | Code hosting & collaboration | PAT (Bearer) | `https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json` |
| **Cloudflare** | CDN, DNS, security | API Key (Bearer) | `https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json` |
| **Notion** | Workspace & docs platform | API Key (Bearer) | `https://raw.githubusercontent.com/Chrischuck/notion-openapi/main/notion-openapi.json` |
| **Linear** | Issue tracking for teams | API Key (Bearer) | `https://raw.githubusercontent.com/nicoepp/linear-openapi-spec/main/openapi.json` |
| **Vercel** | Deployment platform | API Key (Bearer) | `https://openapi.vercel.sh` |
| **Supabase** | Backend-as-a-service | API Key | `https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json` |
| **Plaid** | Banking & finance data | API Key | `https://raw.githubusercontent.com/plaid/plaid-openapi/master/2020-09-14.yml` |
| **OpenAI** | AI model API | API Key (Bearer) | `https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml` |

## Notes

- **Start with Petstore** for quick dev testing — it's small and requires no real credentials.
- **Stripe** spec is very large (~12k endpoints). Good stress test, but slow to synthesise.
- **Resend** is ideal for demos — small, clean spec, real product teams use it.
- All URLs return raw JSON/YAML directly (no HTML page).
