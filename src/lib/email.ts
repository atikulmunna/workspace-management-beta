/**
 * Email transport — powered by Nodemailer + Resend SMTP
 *
 * In test environments (NODE_ENV=test), all sends are silently skipped
 * so test suites don't need SMTP credentials and don't fire real emails.
 *
 * Configuration via env vars (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 */

import nodemailer from 'nodemailer'
import { config } from '../config'

const isTest = process.env.NODE_ENV === 'test'

// ── Transporter ───────────────────────────────────────────────────────────────
// - port 465 → secure: true  (SSL from the start, Resend's recommended setting)
// - port 587 → secure: false (STARTTLS upgrade, fallback)
const transporter = isTest
  ? null
  : nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,   // SSL for 465, STARTTLS for 587
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  })

// Warn at startup if SMTP is not configured (non-test only)
if (!isTest && (!config.email.host || !config.email.pass)) {
  console.warn(
    '[email] ⚠  SMTP not configured — magic links and invitations will silently fail.\n' +
    '           Set SMTP_HOST, SMTP_PASS, and EMAIL_FROM in your .env file.'
  )
}

// ── Shared send helper ────────────────────────────────────────────────────────
async function send(options: nodemailer.SendMailOptions): Promise<void> {
  if (isTest || !transporter) return   // silent no-op in test env

  await transporter.sendMail(options)
}

// ── Shared HTML shell ─────────────────────────────────────────────────────────
function emailShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1E3A5F;padding:28px 40px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">Workspace Service</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                This email was sent by Workspace Service &bull; If you didn't request this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Magic Link Email ──────────────────────────────────────────────────────────
export async function sendMagicLinkEmail({
  to,
  token,
}: {
  to: string
  token: string
}): Promise<void> {
  const verifyUrl = `${config.appUrl}/auth/verify?token=${token}`

  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Your Sign-In Link</h2>
    <p style="margin:0 0 12px;color:#374151;line-height:1.6;">
      Click the button below to sign in. This link expires in
      <strong>${config.magicLink.expiresMinutes} minutes</strong> and can only be used once.
    </p>
    <p style="margin:24px 0;">
      <a href="${verifyUrl}" style="
        display:inline-block;padding:14px 28px;
        background:#1E3A5F;color:#ffffff;
        border-radius:8px;text-decoration:none;
        font-weight:bold;font-size:15px;letter-spacing:0.3px;
      ">Sign In →</a>
    </p>
    <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">
      Or copy this URL into your browser:<br/>
      <a href="${verifyUrl}" style="color:#1E3A5F;word-break:break-all;">${verifyUrl}</a>
    </p>
  `

  await send({
    from: config.email.from,
    to,
    subject: 'Your sign-in link',
    html: emailShell('Sign In', body),
  })
}

// ── Invitation Email ──────────────────────────────────────────────────────────
export async function sendInvitationEmail({
  to,
  workspaceName,
  inviterName,
  invitationId,
}: {
  to: string
  workspaceName: string
  inviterName: string
  invitationId: string
}): Promise<void> {
  const acceptUrl = `${config.appUrl}/invitations/${invitationId}/accept`

  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">You've Been Invited!</h2>
    <p style="margin:0 0 12px;color:#374151;line-height:1.6;">
      <strong>${inviterName}</strong> has invited you to join the
      <strong>${workspaceName}</strong> workspace.
    </p>
    <p style="margin:24px 0;">
      <a href="${acceptUrl}" style="
        display:inline-block;padding:14px 28px;
        background:#4F46E5;color:#ffffff;
        border-radius:8px;text-decoration:none;
        font-weight:bold;font-size:15px;letter-spacing:0.3px;
      ">Accept Invitation →</a>
    </p>
    <p style="margin:16px 0 4px;color:#6b7280;font-size:13px;">This invitation expires in <strong>7 days</strong>.</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">
      Or copy this URL:<br/>
      <a href="${acceptUrl}" style="color:#4F46E5;word-break:break-all;">${acceptUrl}</a>
    </p>
  `

  await send({
    from: config.email.from,
    to,
    subject: `You've been invited to join ${workspaceName}`,
    html: emailShell(`Invitation to ${workspaceName}`, body),
  })
}
