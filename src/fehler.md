Argument of type '{ type: string; common: { name: string; type: string; role: string; read: boolean; write: boolean; }; native: {}; }' is not assignable to parameter of type '(Omit<StateObject, "\_id" | "acl"> & { \_id?: string | undefined; acl?: StateACL | undefined; }) | (Omit<ChannelObject, "\_id" | "acl"> & { ...; }) | ... 10 more ... | (Omit<...> & { ...; })'.
Type '{ type: string; common: { name: string; type: string; role: string; read: boolean; write: boolean; }; native: {}; }' is not assignable to type 'Omit<OtherObject, "\_id" | "acl"> & { \_id?: string | undefined; acl?: ObjectACL | undefined; }'.
Type '{ type: string; common: { name: string; type: string; role: string; read: boolean; write: boolean; }; native: {}; }' is not assignable to type 'Omit<OtherObject, "\_id" | "acl">'.
Types of property 'type' are incompatible.
Type 'string' is not assignable to type '"config" | "chart"'.ts(2345)
