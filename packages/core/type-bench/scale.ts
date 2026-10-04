import type { ActionFor, ShapeOf } from "../src/index.js";
import {
	buildAbility,
	createRules,
	defineAbilities,
	shape,
} from "../src/index.js";

export const ac = defineAbilities({
	resources: {
		r01: {
			schema: shape<{
				id: string;
				status: "draft" | "published";
				views: number;
			}>(),
			actions: ["read", "create", "update", "delete", "publish"],
			relations: {
				author: { resource: "r06", kind: "one" },
				tags: { resource: "r14", kind: "many" },
			},
		},
		r02: {
			schema: shape<{ id: string; title: string }>(),
			actions: ["read", "update"],
		},
		r03: {
			schema: shape<{ id: string; count: number; active: boolean }>(),
			actions: ["read", "create", "delete"],
		},
		r04: {
			schema: shape<{ id: string; name: string; createdAt: Date }>(),
			actions: ["read", "update", "archive"],
		},
		r05: {
			schema: shape<{ id: string; price: number; currency: "usd" | "eur" }>(),
			actions: ["read", "update"],
		},
		r06: {
			schema: shape<{ id: string; email: string; verified: boolean }>(),
			actions: ["read", "create", "update", "delete"],
			relations: { profile: { resource: "r04", kind: "one" } },
		},
		r07: { schema: shape<{ id: string; score: number }>(), actions: ["read"] },
		r08: {
			schema: shape<{ id: string; label: string; weight: number }>(),
			actions: ["read", "update"],
		},
		r09: {
			schema: shape<{ id: string; kind: "a" | "b" | "c"; size: number }>(),
			actions: ["read", "create"],
		},
		r10: {
			schema: shape<{ id: string; body: string; pinned: boolean }>(),
			actions: ["read", "update", "delete"],
		},
		r11: {
			schema: shape<{ id: string; total: number; paid: boolean }>(),
			actions: ["read", "refund"],
		},
		r12: {
			schema: shape<{ id: string; slug: string }>(),
			actions: ["read", "update"],
		},
		r13: {
			schema: shape<{ id: string; level: number; locked: boolean }>(),
			actions: ["read", "unlock"],
		},
		r14: {
			schema: shape<{ id: string; tag: string; rank: number }>(),
			actions: ["read", "create", "delete"],
		},
		r15: {
			schema: shape<{ id: string; due: Date; done: boolean }>(),
			actions: ["read", "update", "complete"],
		},
		r16: {
			schema: shape<{ id: string; region: "eu" | "us" | "apac" }>(),
			actions: ["read"],
		},
		r17: {
			schema: shape<{ id: string; amount: number; note: string }>(),
			actions: ["read", "update"],
		},
		r18: {
			schema: shape<{ id: string; flag: boolean; ratio: number }>(),
			actions: ["read", "toggle"],
		},
		r19: {
			schema: shape<{ id: string; code: string; uses: number }>(),
			actions: ["read", "create", "delete"],
		},
		r20: {
			schema: shape<{ id: string; phase: "open" | "closed"; budget: number }>(),
			actions: ["read", "update", "close"],
		},
		r21: {
			schema: shape<{ id: string; height: number; width: number }>(),
			actions: ["read", "update"],
		},
		r22: {
			schema: shape<{ id: string; subject: string; read: boolean }>(),
			actions: ["read", "archive"],
		},
		r23: {
			schema: shape<{ id: string; lat: number; lng: number }>(),
			actions: ["read"],
		},
		r24: {
			schema: shape<{ id: string; version: number; draft: boolean }>(),
			actions: ["read", "update", "promote"],
		},
		r25: {
			schema: shape<{ id: string; x: number; y: string; z: boolean }>(),
			actions: ["read", "create", "update", "delete"],
		},
	},
});

const { allow, deny } = createRules(ac);

export const policy = () => [
	allow("read", "r01", { where: { status: { eq: "published" } } }),
	allow(
		["update", "publish"],
		{ r01: ["status"] },
		{
			where: { views: { gte: 100 } },
			values: { status: { in: ["draft", "published"] } },
		},
	),
	deny("update", { r01: ["views"] }),
	allow("read", "r04", { where: { name: { contains: "x" } } }),
	allow("update", "r05", { where: { currency: { eq: "usd" } } }),
	allow("read", "r15", { where: { done: { eq: false } } }),
	deny("complete", "r15", { where: { due: { lt: new Date() } } }),
	allow("read", "r20", { where: { phase: { eq: "open" }, budget: { gt: 0 } } }),
	allow("manage", "r25"),
	allow("read", "r01", {
		where: { author: { verified: { eq: true } } },
	}),
	allow("create", "r01", {
		where: { tags: { some: { rank: { gt: 5 } } } },
	}),
	allow("update", "r01", {
		where: { author: { profile: { name: { contains: "x" } } } },
	}),
	allow("delete", "r01", {
		where: {
			status: { eq: "draft" },
			tags: { none: { rank: { lt: 0 } } },
		},
	}),
];

const ability = buildAbility(ac, policy());

ability.can("read", "r01", { id: "1", status: "published", views: 10 });
ability.canMutate("update", "r05", { id: "1", price: 5, currency: "usd" });
ability.validatePayload(
	"update",
	"r01",
	{ id: "1", status: "draft", views: 1 },
	{ status: "published" },
);
ability.where("read", "r20");

export type ActionR09 = ActionFor<typeof ac, "r09">;
export type ShapeR24 = ShapeOf<typeof ac, "r24">;
