import type { ResourceMap, ResourceName } from "@vetojs/core";
import type { ReactNode } from "react";
import type { ServerCanProps } from "./types.js";

/**
 * Gates children in a server component, with no context and no hooks.
 *
 * Takes the ability directly, so the resource map is inferred from it and there is no
 * factory to set up. Nothing here reaches the browser — use it wherever you already have
 * an ability, and reach for the client bindings only where the UI has to react.
 *
 * @example
 * const ability = await getAbility();
 *
 * <Can ability={ability} I="update" a="post" this={post} fallback={<ReadOnly />}>
 *   <EditForm post={post} />
 * </Can>
 */
export const Can = <AC extends ResourceMap, R extends ResourceName<AC>>({
	ability,
	I,
	a,
	this: row,
	children,
	fallback = null,
}: ServerCanProps<AC, R>): ReactNode => {
	return ability.can(I, a, row) ? children : fallback;
};
