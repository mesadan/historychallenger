# Paintings game — Cloudflare setup

Three things to do on Cloudflare while the curation run finishes. Do them in order.

---

## 1. Create the R2 bucket

1. Cloudflare dashboard → **R2** → **Create bucket**
2. Name: `paintings` (lowercase, no spaces)
3. Location: automatic
4. Leave other settings default
5. Create

### Enable public access (needed so the game can show images)

1. Open the bucket → **Settings** tab
2. **Public access** → click **"Allow Access"** under "Public Development URL"
3. Copy the **Public bucket URL** that appears. It looks like:

   ```
   https://pub-abcdef1234567890.r2.dev
   ```

4. Save that URL — you'll paste it into the worker config later.

> For production you can swap this for a custom domain like `paintings.historychallenger.com`, but the dev URL works fine to start.

### Get R2 API tokens (for the bulk upload script)

1. Cloudflare dashboard → **R2** → **Manage R2 API Tokens** (top right)
2. **Create API token**
3. Name: `paintings-upload`
4. Permissions: **Object Read & Write**
5. Specify bucket: `paintings`
6. Create → copy the three values shown:
   - **Access Key ID**
   - **Secret Access Key**
   - **Endpoint** (looks like `https://<account>.r2.cloudflarestorage.com`)

You'll need these three for the upload script in step 3.

---

## 2. Run the D1 schema

1. Cloudflare dashboard → **Workers & Pages** → **D1** → your database → **Console**
2. Open [`scripts/paintings_schema.sql`](./paintings_schema.sql)
3. Paste the whole file into the console, click **Execute**

Verify:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('artworks','painting_sessions');
```

Should return two rows.

---

## 3. Add R2 public URL to the worker

The worker needs to know the public R2 URL so it can generate image URLs for the game.

1. Cloudflare dashboard → **Workers & Pages** → your worker (`histroychallenger-api`) → **Settings** → **Variables and Secrets**
2. Add variable:
   - Name: `R2_PAINTINGS_BASE_URL`
   - Value: the public URL you copied in step 1 (e.g. `https://pub-abcdef1234567890.r2.dev`)
   - Type: Plaintext (not secret — it's meant to be public)
3. Save

---

## 4. Run the upload script (after curation finishes)

When `curate_paintings.mjs` produces `paintings_data/manifest.json`, run:

```
cd c:\Users\DELL\Documents\historychallenger\scripts
npm install          # first time only, installs @aws-sdk/client-s3
$env:R2_ACCOUNT_ID     = "your-account-id-from-endpoint"
$env:R2_ACCESS_KEY_ID  = "paste-from-step-1"
$env:R2_SECRET_KEY     = "paste-from-step-1"
$env:R2_BUCKET         = "paintings"
node upload_paintings.mjs
```

The account ID is the prefix in the endpoint URL — if the endpoint is
`https://abc123.r2.cloudflarestorage.com`, your account ID is `abc123`.

The script:
1. Uploads every image + thumb from `paintings_data/` to the R2 bucket
2. Writes `scripts/artworks_seed.sql` with INSERT statements for all 500 artworks

### Load the seed SQL

Paste `scripts/artworks_seed.sql` into the D1 Console and execute.

---

## 5. Done. Test the game.

Open `/paintings.html` on the site. Pick a difficulty and play.
