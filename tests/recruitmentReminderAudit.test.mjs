import assert from "node:assert/strict";
import test from "node:test";

import {
  ChannelType,
} from "discord.js";

import {
  OfficerThreadManager,
} from "../dist/officers/officerThreadManager.js";

test(
  "retries a missing reminder audit without sending another recruiter DM",
  async () => {
    const auditPayloads = [];
    let recruiterFetches = 0;
    let stateSaves = 0;

    const client = {
      users: {
        fetch: async () => {
          recruiterFetches++;
          throw new Error(
            "A retry must not send another DM.",
          );
        },
      },

      channels: {
        fetch: async (channelId) => {
          assert.equal(
            channelId,
            "audit-channel",
          );

          return {
            type: ChannelType.GuildText,
            send: async (payload) => {
              auditPayloads.push(payload);

              return {
                url:
                  "https://discord.com/channels/guild/audit/message",
              };
            },
          };
        },
      },
    };

    const manager = new OfficerThreadManager(
      client,
      "output-channel",
      "audit-channel",
      ["officer"],
    );

    const recruitmentCase = {
      id: "candidate-output-message",
      candidateName: "Remindercandidate",
      candidateRealm: "Area 52",
      candidateStatus: "MANUAL_REVIEW",
      candidateOutputMessageUrl:
        "https://discord.com/channels/guild/source/candidate",
      guildId: "guild",
      assignedOfficerId: "officer",
      assignedAt:
        "2026-08-01T00:00:00.000Z",
      threadId: "officer-thread",
      assignmentMessageId:
        "assignment-message",
      assignmentMessageUrl:
        "https://discord.com/channels/guild/officer-thread/assignment-message",
      status: "ASSIGNED",
      reminderStage: "ASSIGNED",
      reminderSentAt:
        "2026-08-01T12:00:00.000Z",
      pendingReminderAudits: [
        {
          stage: "ASSIGNED",
          sentAt:
            "2026-08-01T12:00:00.000Z",
        },
      ],
    };

    manager.state = {
      nextOfficerIndex: 0,
      threadIdsByOfficer: {},
      casesById: {
        [recruitmentCase.id]:
          recruitmentCase,
      },
    };

    manager.saveState = async () => {
      stateSaves++;
    };

    manager.recordRecruiterAction(
      recruitmentCase,
      "2026-08-01T12:05:00.000Z",
    );

    assert.equal(
      recruitmentCase.reminderStage,
      undefined,
    );
    assert.equal(
      recruitmentCase.reminderSentAt,
      undefined,
    );
    assert.equal(
      recruitmentCase
        .pendingReminderAudits.length,
      1,
    );

    await manager
      .processRecruitmentReminders();

    assert.equal(recruiterFetches, 0);
    assert.equal(auditPayloads.length, 1);
    assert.equal(stateSaves, 1);
    assert.equal(
      recruitmentCase
        .lastReminderAuditMessageUrl,
      "https://discord.com/channels/guild/audit/message",
    );
    assert.equal(
      recruitmentCase
        .pendingReminderAudits,
      undefined,
    );

    const auditContent =
      auditPayloads[0].content;

    assert.match(
      auditContent,
      /Recruitment reminder sent/,
    );
    assert.match(
      auditContent,
      /\*\*Recruiter:\*\* <@officer>/,
    );
    assert.match(
      auditContent,
      /\*\*Workflow stage:\*\* Assigned/,
    );
    assert.match(
      auditContent,
      /\*\*Inactive for:\*\* 12 hours/,
    );
    assert.match(
      auditContent,
      /\*\*Officer assignment:\*\* \[View assignment]/,
    );
    assert.deepEqual(
      auditPayloads[0].allowedMentions,
      { parse: [] },
    );
  },
);
