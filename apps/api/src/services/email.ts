// Email service using Resend

interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

interface ResendResponse {
  id?: string
  error?: string
}

// Default from address - verified with Resend for leangoapp.com
const DEFAULT_FROM = 'LeanGo QMS <notifications@leangoapp.com>'

export async function sendEmail(
  apiKey: string | undefined,
  options: EmailOptions
): Promise<{ success: boolean; error?: string }> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to]

  // Skip if no recipients
  if (recipients.length === 0) {
    return { success: true }
  }

  // In dev mode without API key, just log the email
  if (!apiKey) {
    console.log('[DEV EMAIL]', {
      to: recipients,
      subject: options.subject,
      preview: options.text?.substring(0, 200) || options.html.substring(0, 200) + '...',
    })
    return { success: true }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to: recipients,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    })

    const data: ResendResponse = await response.json()

    if (!response.ok) {
      console.error('Resend error:', data)
      return { success: false, error: data.error || 'Failed to send email' }
    }

    return { success: true }
  } catch (error) {
    console.error('Email send error:', error)
    return { success: false, error: 'Failed to send email' }
  }
}

// Email templates
export function verificationCodeEmail(code: string): { subject: string; html: string } {
  return {
    subject: 'Your QMS Verification Code',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1f2937;">QMS Verification Code</h2>
        <p style="color: #4b5563;">Use the following code to verify your email address:</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1f2937;">${code}</span>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes.</p>
        <p style="color: #6b7280; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `,
  }
}

export function passwordResetEmail(code: string): { subject: string; html: string } {
  return {
    subject: 'Reset Your QMS Password',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1f2937;">Password Reset Request</h2>
        <p style="color: #4b5563;">Use the following code to reset your password:</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1f2937;">${code}</span>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes.</p>
        <p style="color: #6b7280; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  }
}

export function inviteEmail(
  organizationName: string,
  inviteUrl: string,
  inviterName?: string
): { subject: string; html: string } {
  return {
    subject: `You've been invited to join ${organizationName} on QMS`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1f2937;">You're Invited!</h2>
        <p style="color: #4b5563;">
          ${inviterName ? `${inviterName} has invited` : 'You have been invited'} to join
          <strong>${organizationName}</strong> on QMS (Quality Management System).
        </p>
        <div style="margin: 24px 0;">
          <a href="${inviteUrl}"
             style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This invitation expires in 7 days.</p>
        <p style="color: #6b7280; font-size: 14px;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    `,
  }
}

export function ncrSubmissionEmail(params: {
  ncrNumber: string
  title: string | null
  severity: string | null
  supplierName: string | null
  submitterName: string | null
  submitterEmail: string | null
  ncrUrl: string
  orgName: string
}): { subject: string; html: string; text: string } {
  const subject = `[${params.orgName}] New NCR Submitted: ${params.ncrNumber}`

  const text = `
A new Non-Conformance Report has been submitted.

NCR Number: ${params.ncrNumber}
Title: ${params.title || 'No title'}
Severity: ${params.severity || 'Not specified'}
Supplier: ${params.supplierName || 'Not specified'}

Submitted by: ${params.submitterName || 'Anonymous'}${params.submitterEmail ? ` (${params.submitterEmail})` : ''}

View the NCR: ${params.ncrUrl}

---
This is an automated notification from ${params.orgName} QMS.
`.trim()

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1f2937;">New NCR Submitted</h2>
      <p style="color: #4b5563;">A new Non-Conformance Report has been submitted and requires your attention.</p>

      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 24px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; width: 120px;">NCR Number:</td>
            <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${params.ncrNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Title:</td>
            <td style="padding: 8px 0; color: #1f2937;">${params.title || 'No title'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Severity:</td>
            <td style="padding: 8px 0; color: #1f2937;">${params.severity || 'Not specified'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Supplier:</td>
            <td style="padding: 8px 0; color: #1f2937;">${params.supplierName || 'Not specified'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Submitted by:</td>
            <td style="padding: 8px 0; color: #1f2937;">${params.submitterName || 'Anonymous'}${params.submitterEmail ? ` (${params.submitterEmail})` : ''}</td>
          </tr>
        </table>
      </div>

      <div style="margin: 24px 0;">
        <a href="${params.ncrUrl}"
           style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          View NCR
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">
        This is an automated notification from ${params.orgName} QMS.
      </p>
    </div>
  `

  return { subject, html, text }
}

export function orgAddedEmail(params: {
  orgName: string
  inviterName: string
  loginUrl: string
  isNewUser: boolean
}): { subject: string; html: string; text: string } {
  const subject = params.isNewUser
    ? `You've been invited to join ${params.orgName}`
    : `You've been added to ${params.orgName}`

  const actionText = params.isNewUser ? 'Create Account' : 'Log In'

  const text = params.isNewUser
    ? `
${params.inviterName} has invited you to join ${params.orgName} on LeanGo QMS.

To accept this invitation and create your account, visit:
${params.loginUrl}

If you weren't expecting this invitation, you can safely ignore this email.

---
LeanGo QMS
`.trim()
    : `
${params.inviterName} has added you to ${params.orgName} on LeanGo QMS.

You can now access ${params.orgName} by logging in:
${params.loginUrl}

If you have any questions, please contact your organization administrator.

---
LeanGo QMS
`.trim()

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1f2937;">${params.isNewUser ? "You're Invited!" : "You've Been Added"}</h2>
      <p style="color: #4b5563;">
        ${params.inviterName} has ${params.isNewUser ? 'invited you to join' : 'added you to'}
        <strong>${params.orgName}</strong> on LeanGo QMS.
      </p>

      <div style="margin: 24px 0;">
        <a href="${params.loginUrl}"
           style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          ${actionText}
        </a>
      </div>

      <p style="color: #6b7280; font-size: 14px;">
        ${params.isNewUser
          ? "If you weren't expecting this invitation, you can safely ignore this email."
          : "If you have any questions, please contact your organization administrator."
        }
      </p>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">
        LeanGo QMS
      </p>
    </div>
  `

  return { subject, html, text }
}
