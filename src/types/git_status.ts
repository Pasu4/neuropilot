import { Status, RefType } from './git.d';

export const StatusStrings: Record<Status, string> = {
    [Status.INDEX_MODIFIED]:     'Index modified',
    [Status.INDEX_ADDED]:        'Index added',
    [Status.INDEX_DELETED]:      'Index deleted',
    [Status.INDEX_RENAMED]:      'Index renamed',
    [Status.INDEX_COPIED]:       'Index copied',

    [Status.MODIFIED]:           'Modified',
    [Status.DELETED]:            'Deleted',
    [Status.UNTRACKED]:          'Untracked',
    [Status.IGNORED]:            'Ignored',
    [Status.INTENT_TO_ADD]:      'Intent to add',
    [Status.INTENT_TO_RENAME]:   'Intent to rename',
    [Status.TYPE_CHANGED]:       'Type changed',

    [Status.ADDED_BY_US]:        'Added by us',
    [Status.ADDED_BY_THEM]:      'Added by them',
    [Status.DELETED_BY_US]:      'Deleted by us',
    [Status.DELETED_BY_THEM]:    'Deleted by them',
    [Status.BOTH_ADDED]:         'Both added',
    [Status.BOTH_DELETED]:       'Both deleted',
    [Status.BOTH_MODIFIED]:      'Both modified',
} as const;

export const RefTypeStrings: Record<RefType, string> = {
    [RefType.Head]: 'Head',
    [RefType.RemoteHead]: 'Remote head',
    [RefType.Tag]: 'Tag',
} as const;
