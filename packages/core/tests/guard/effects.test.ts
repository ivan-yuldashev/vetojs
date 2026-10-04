import { beforeEach, describe, expect, it } from "vitest";
import { buildAbility } from "../../src/api/index.js";
import { createRules, defineAbilities, shape } from "../../src/create/index.js";
import { ForbiddenError } from "../../src/errors/index.js";
import { createGuard } from "../../src/guard/index.js";

type Actor = { id: string; workspaceId: string };

const ac = defineAbilities({
	resources: {
		email: {
			schema: shape<{
				workspaceId: string;
				recipientDomain: string;
				attachments: number;
			}>(),
			actions: ["send"],
		},
		charge: {
			schema: shape<{
				workspaceId: string;
				currency: string;
				amountCents: number;
			}>(),
			actions: ["create"],
		},
	},
});

const { allow, deny } = createRules(ac);

const policyFor = (actor: Actor) => [
	allow("send", "email", {
		where: {
			workspaceId: actor.workspaceId,
			recipientDomain: { in: ["acme.com"] },
		},
	}),
	deny("send", "email", { where: { attachments: { gt: 0 } } }),
	allow(
		"create",
		{ charge: ["amountCents"] },
		{
			where: { workspaceId: actor.workspaceId, currency: "usd" },
			values: { amountCents: { lte: 5000 } },
		},
	),
];

const agent: Actor = { id: "agent-1", workspaceId: "w1" };

const withPermission = createGuard({
	ac,
	getActor: (): Actor => agent,
	policy: policyFor,
});

const domainOf = (address: string): string =>
	address.slice(address.lastIndexOf("@") + 1).toLowerCase();

type SendArgs = { to: string; attachments: string[] };
type ChargeArgs = { currency: string; amountCents: number };

let sent: string[];
let charged: number[];

beforeEach(() => {
	sent = [];
	charged = [];
});

const sendEmail = withPermission(
	{
		action: "send",
		resource: "email",
		load: (args: SendArgs) => ({
			workspaceId: agent.workspaceId,
			recipientDomain: domainOf(args.to),
			attachments: args.attachments.length,
		}),
	},
	async (_ctx, args: SendArgs) => {
		sent.push(args.to);
		return `sent to ${args.to}`;
	},
);

const createCharge = withPermission(
	{
		action: "create",
		resource: "charge",
		load: (args: ChargeArgs) => ({
			workspaceId: agent.workspaceId,
			currency: args.currency,
			amountCents: args.amountCents,
		}),
		payload: (args: ChargeArgs) => ({ amountCents: args.amountCents }),
	},
	async (ctx) => {
		charged.push(ctx.payload.amountCents ?? 0);
		return "charged";
	},
);

describe("guarding an effect that has no row to load", () => {
	it("runs the effect when the synthesized row satisfies the policy", async () => {
		expect(await sendEmail({ to: "ceo@acme.com", attachments: [] })).toBe(
			"sent to ceo@acme.com",
		);
		expect(sent).toEqual(["ceo@acme.com"]);
	});

	it("leaves the effect undone when the policy refuses", async () => {
		await expect(
			sendEmail({ to: "ceo@other.com", attachments: [] }),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(sent).toEqual([]);
	});

	it("refuses a lookalike domain that substring matching would accept", async () => {
		const address = "ceo@acme.com.evil.io";

		expect(address.includes("@acme.com")).toBe(true);

		await expect(sendEmail({ to: address, attachments: [] })).rejects.toThrow(
			ForbiddenError,
		);
		expect(sent).toEqual([]);
	});

	it("refuses an address whose local part carries the permitted domain", async () => {
		await expect(
			sendEmail({ to: "ceo@acme.com@evil.io", attachments: [] }),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(sent).toEqual([]);
	});

	it("applies a conditional deny to the synthesized row", async () => {
		await expect(
			sendEmail({ to: "ceo@acme.com", attachments: ["report.pdf"] }),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(sent).toEqual([]);
	});

	it("refuses an effect for another actor's workspace", async () => {
		const foreign = withPermission(
			{
				action: "send",
				resource: "email",
				load: (args: SendArgs) => ({
					workspaceId: "w2",
					recipientDomain: domainOf(args.to),
					attachments: args.attachments.length,
				}),
			},
			async () => {
				sent.push("leaked");
				return "sent";
			},
		);

		await expect(
			foreign({ to: "ceo@acme.com", attachments: [] }),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(sent).toEqual([]);
	});

	it("allows an amount at the cap and names the field when it is over", async () => {
		expect(await createCharge({ currency: "usd", amountCents: 5000 })).toBe(
			"charged",
		);
		expect(charged).toEqual([5000]);

		const error = await createCharge({
			currency: "usd",
			amountCents: 5001,
		}).catch((thrown: unknown) => thrown);

		expect(ForbiddenError.is(error)).toBe(true);
		expect(
			ForbiddenError.is(error) ? error.violations?.[0]?.field : undefined,
		).toBe("amountCents");
		expect(charged).toEqual([5000]);
	});

	it("refuses a currency the policy never granted", async () => {
		await expect(
			createCharge({ currency: "btc", amountCents: 1 }),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(charged).toEqual([]);
	});

	it("answers optimistically without a row, which is why an effect synthesizes one", () => {
		const ability = buildAbility(ac, policyFor(agent));

		expect(ability.can("send", "email")).toBe(true);
		expect(
			ability.can("send", "email", {
				workspaceId: "w1",
				recipientDomain: "evil.io",
				attachments: 0,
			}),
		).toBe(false);
	});
});
