import {
    ValidatorConstraint,
    ValidatorConstraintInterface,
    ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsExternalOrLastfm', async: false })
export class IsExternalOrLastfm implements ValidatorConstraintInterface {
    validate(_: any, args: ValidationArguments) {
        const o = args.object as any;

        if (o.songId) return true;

        const hasExternal = !!o.externalId;
        const hasLastfm = !!o.lastfmId;

        return (hasExternal || hasLastfm) && !(hasExternal && hasLastfm);
    }

    defaultMessage() {
        return 'Provide exactly one of externalId or lastfmId when songId is absent';
    }
}