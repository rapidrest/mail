///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CalendarEventMongo, MailboxMongo } from "../../../mongo.js";
import { MeetingResponseCommand } from "../MeetingResponseCommand.js";

/**
 * @author Jean-Philippe Steinmetz
 */
export class MeetingResponseCommandMongo extends MeetingResponseCommand {
    protected calendarEventClass: any = CalendarEventMongo;
    protected mailboxClass: any = MailboxMongo;
}
