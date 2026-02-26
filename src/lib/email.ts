import nodemailer from 'nodemailer'
import { config } from '../config'

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
})

export async function sendMagicLinkEmail({
  to,
  token,
}: {
  to: string
  token: string
}) {
  const verifyUrl = `${config.appUrl}/auth/verify?token=${token}`

  await transporter.sendMail({
    from: config.email.from,
    to,
    subject: 'Your sign-in link',
    html: `
      <p>Hi,</p>
      <p>Click the button below to sign in. This link expires in <strong>${config.magicLink.expiresMinutes} minutes</strong> and can only be used once.</p>
      <p>
        <a href="${verifyUrl}" style="
          display: inline-block;
          padding: 12px 24px;
          background: #1E3A5F;
          color: white;
          border-radius: 6px;
          text-decoration: none;
          font-weight: bold;
          font-family: Arial, sans-serif;
        ">
          Sign In
        </a>
      </p>
      <p style="color: #888; font-size: 12px;">
        If you didn't request this, you can safely ignore this email.
        This link will expire on its own.
      </p>
      <p style="color: #888; font-size: 12px;">
        Or copy this URL into your browser:<br/>
        <a href="${verifyUrl}">${verifyUrl}</a>
      </p>
    `,
  })
}

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
}) {
  const acceptUrl = `${config.appUrl}/invitations/${invitationId}/accept`

  await transporter.sendMail({
    from: config.email.from,
    to,
    subject: `You've been invited to join ${workspaceName}`,
    html: `
      <p>Hi there,</p>
      <p><strong>${inviterName}</strong> has invited you to join the <strong>${workspaceName}</strong> workspace.</p>
      <p>
        <a href="${acceptUrl}" style="
          display: inline-block;
          padding: 12px 24px;
          background: #4F46E5;
          color: white;
          border-radius: 6px;
          text-decoration: none;
          font-weight: bold;
        ">
          Accept Invitation
        </a>
      </p>
      <p>This invitation will expire in 7 days.</p>
      <p>If you didn't expect this, you can safely ignore this email.</p>
    `,
  })
}
