# ZETAMAX WhatsApp worker deployment bundle

This is the separately hosted worker used by the ZETAMAX dashboard. It produces a real WhatsApp pairing QR through Baileys and stores session credentials on a persistent disk.

## Deploy with Render

1. Upload these files to a Git repository that your Render account can access.
2. In Render, create a new Blueprint from that repository and select `render.yaml`.
3. Review the plan and charges before confirming. The Blueprint uses an always-on service and a persistent 1 GB disk; this is not a free persistent setup.
4. After the service is live, copy its HTTPS URL and the generated `ZETAMAX_WORKER_TOKEN`.
5. In the AppDeploy dashboard app, configure backend secrets `ZETAMAX_WORKER_URL` (service URL without a trailing slash) and `ZETAMAX_WORKER_TOKEN` (the exact generated token).
6. Open ZETAMAX, select a bot, choose **Pair WhatsApp**, then scan the live QR using WhatsApp → Linked devices → Link a device.

Do not share the worker token, QR code, or session directory. The worker has not been deployed merely by downloading this bundle.

## Endpoints

- `GET /health`
- `POST /bots/:botId/action` with JSON `{ "action": "pair|start|stop|restart" }` and `Authorization: Bearer <token>`
- `GET /bots/:botId/pairing` with `Authorization: Bearer <token>`
