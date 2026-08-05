import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';

const _roomTypes = <String>[
  'CLASSROOM',
  'LABORATORY',
  'SEMINAR_HALL',
  'AUDITORIUM',
  'STAFF_ROOM',
  'HOD_ROOM',
  'PRINCIPAL_OFFICE',
  'ADMINISTRATIVE_OFFICE',
  'LIBRARY',
  'WORKSHOP',
  'RESTROOM',
  'CANTEEN',
  'HOSTEL_ROOM',
  'CORRIDOR',
  'STAIRCASE',
  'PARKING_AREA',
  'PLAYGROUND',
  'OTHER',
];

class CampusSetupScreen extends StatelessWidget {
  const CampusSetupScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 5,
      child: Column(
        children: [
          const TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: 'Campuses'),
              Tab(text: 'Blocks'),
              Tab(text: 'Floors'),
              Tab(text: 'Rooms'),
              Tab(text: 'Archived'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: [
                _LocationList(client: client, type: 'campus'),
                _LocationList(client: client, type: 'block'),
                _LocationList(client: client, type: 'floor'),
                _LocationList(client: client, type: 'room'),
                ArchivedLocationsScreen(client: client),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ArchivedLocationsScreen extends StatelessWidget {
  const ArchivedLocationsScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  Widget build(BuildContext context) {
    return _LocationList(client: client, type: 'campus', archivedOnly: true);
  }
}

class _LocationList extends StatefulWidget {
  const _LocationList({
    required this.client,
    required this.type,
    this.archivedOnly = false,
  });

  final AvsApiClient client;
  final String type;
  final bool archivedOnly;

  @override
  State<_LocationList> createState() => _LocationListState();
}

class _LocationListState extends State<_LocationList> {
  final _search = TextEditingController();
  final Set<String> _selected = {};
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  Object? _error;
  String _status = 'ALL';
  String _archivedType = 'campus';

  String get _type => widget.archivedOnly ? _archivedType : widget.type;
  String get _plural => _type == 'campus' ? 'campuses' : '${_type}s';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final status = widget.archivedOnly
          ? 'ARCHIVED'
          : _status == 'ALL'
              ? ''
              : _status;
      final query = <String>[
        if (_search.text.trim().isNotEmpty)
          'search=${Uri.encodeQueryComponent(_search.text.trim())}',
        if (status.isNotEmpty) 'status=$status',
      ].join('&');
      final value =
          await widget.client.get('/admin/$_plural${query.isEmpty ? '' : '?$query'}');
      _rows = (value as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      _selected.removeWhere(
        (id) => !_rows.any((row) => row['id']?.toString() == id),
      );
    } catch (error) {
      _error = error;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _archive(Map<String, dynamic> row) async {
    final reason = await _textDialog(
      title: 'Archive ${row['name']}',
      hint: 'Reason for archiving',
    );
    if (reason == null) return;
    await _action(
      () => widget.client.post(
        '/admin/$_type/${row['id']}/archive',
        {'reason': reason},
      ),
    );
  }

  Future<void> _restore(Map<String, dynamic> row) {
    return _action(
      () => widget.client.post(
        '/admin/$_type/${row['id']}/restore',
        const {},
      ),
    );
  }

  Future<void> _dependencies(Map<String, dynamic> row) async {
    await _action(() async {
      final value = await widget.client
          .get('/admin/$_type/${row['id']}/dependencies');
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Dependency report'),
          content: SingleChildScrollView(
            child: SelectableText(_pretty(value)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    }, reload: false);
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    await _dependencies(row);
    if (!mounted) return;
    final reason = await _textDialog(
      title: 'Permanently delete ${row['name']}',
      hint: 'Reason (dependencies must be zero)',
      confirmation: 'PERMANENTLY DELETE LOCATION',
    );
    if (reason == null) return;
    await _action(
      () => widget.client.delete(
        '/admin/$_type/${row['id']}',
        {
          'reason': reason,
          'confirmationPhrase': 'PERMANENTLY DELETE LOCATION',
        },
      ),
    );
  }

  Future<void> _bulk(bool restore) async {
    if (_selected.isEmpty) return;
    final reason = restore
        ? 'Restored through archived locations'
        : await _textDialog(
            title: 'Archive ${_selected.length} locations',
            hint: 'Reason for bulk archive',
          );
    if (reason == null) return;
    await _action(
      () => widget.client.post(
        '/admin/locations/$_type/bulk-${restore ? 'restore' : 'archive'}',
        {'ids': _selected.toList(), 'reason': reason},
      ),
    );
  }

  Future<void> _action(
    Future<dynamic> Function() action, {
    bool reload = true,
  }) async {
    try {
      await action();
      if (reload) await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    }
  }

  Future<String?> _textDialog({
    required String title,
    required String hint,
    String? confirmation,
  }) async {
    final reason = TextEditingController();
    final phrase = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: reason,
                maxLines: 3,
                decoration: InputDecoration(labelText: hint),
              ),
              if (confirmation != null) ...[
                const SizedBox(height: 12),
                SelectableText('Type: $confirmation'),
                const SizedBox(height: 8),
                TextField(
                  controller: phrase,
                  decoration:
                      const InputDecoration(labelText: 'Confirmation phrase'),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (reason.text.trim().length < 3 ||
                  (confirmation != null && phrase.text != confirmation)) {
                return;
              }
              Navigator.pop(context, reason.text.trim());
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    reason.dispose();
    phrase.dispose();
    return result;
  }

  String _pretty(dynamic value) {
    if (value is Map) {
      return value.entries.map((entry) => '${entry.key}: ${entry.value}').join('\n');
    }
    return '$value';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Unable to load campus locations.\n$_error',
                textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    return Scaffold(
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (widget.archivedOnly)
                  DropdownButton<String>(
                    value: _archivedType,
                    items: const [
                      DropdownMenuItem(value: 'campus', child: Text('Campuses')),
                      DropdownMenuItem(value: 'block', child: Text('Blocks')),
                      DropdownMenuItem(value: 'floor', child: Text('Floors')),
                      DropdownMenuItem(value: 'room', child: Text('Rooms')),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() => _archivedType = value);
                      _load();
                    },
                  ),
                SizedBox(
                  width: 280,
                  child: TextField(
                    controller: _search,
                    onSubmitted: (_) => _load(),
                    decoration: InputDecoration(
                      labelText: 'Search $_plural',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: IconButton(
                        onPressed: _load,
                        icon: const Icon(Icons.arrow_forward),
                      ),
                    ),
                  ),
                ),
                if (!widget.archivedOnly)
                  DropdownButton<String>(
                    value: _status,
                    items: const [
                      DropdownMenuItem(value: 'ALL', child: Text('All status')),
                      DropdownMenuItem(value: 'ACTIVE', child: Text('Active')),
                      DropdownMenuItem(value: 'INACTIVE', child: Text('Inactive')),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() => _status = value);
                      _load();
                    },
                  ),
                if (_selected.isNotEmpty)
                  FilledButton.tonalIcon(
                    onPressed: () => _bulk(widget.archivedOnly),
                    icon: Icon(widget.archivedOnly
                        ? Icons.restore
                        : Icons.archive_outlined),
                    label: Text(widget.archivedOnly
                        ? 'Restore selected'
                        : 'Archive selected'),
                  ),
              ],
            ),
          ),
          Expanded(
            child: _rows.isEmpty
                ? Center(
                    child: Text(widget.archivedOnly
                        ? 'No archived locations found.'
                        : 'No campus locations found.'),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.builder(
                      itemCount: _rows.length,
                      itemBuilder: (context, index) {
                        final row = _rows[index];
                        final id = row['id'].toString();
                        final archived = row['archivedAt'] != null;
                        return CheckboxListTile(
                          value: _selected.contains(id),
                          onChanged: (selected) => setState(() {
                            selected == true
                                ? _selected.add(id)
                                : _selected.remove(id);
                          }),
                          title: Text('${row['name']} (${row['code']})'),
                          subtitle: Text(
                            '${row['isActive'] == true ? 'Active' : 'Inactive'}'
                            '${row['_count'] == null ? '' : ' • ${_pretty(row['_count']).replaceAll('\n', ', ')}'}',
                          ),
                          secondary: PopupMenuButton<String>(
                            onSelected: (value) {
                              if (value == 'edit') {
                                _edit(row);
                              } else if (value == 'dependencies') {
                                _dependencies(row);
                              } else if (value == 'archive') {
                                _archive(row);
                              } else if (value == 'restore') {
                                _restore(row);
                              } else if (value == 'delete') {
                                _delete(row);
                              }
                            },
                            itemBuilder: (_) => [
                              if (!archived)
                                const PopupMenuItem(
                                    value: 'edit', child: Text('Edit')),
                              const PopupMenuItem(
                                  value: 'dependencies',
                                  child: Text('Dependency report')),
                              PopupMenuItem(
                                value: archived ? 'restore' : 'archive',
                                child: Text(archived ? 'Restore' : 'Archive'),
                              ),
                              if (archived)
                                const PopupMenuItem(
                                  value: 'delete',
                                  child: Text('Delete safely'),
                                ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
      floatingActionButton: widget.archivedOnly
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _edit(null),
              icon: const Icon(Icons.add),
              label: Text('Add $_type'),
            ),
    );
  }

  Future<void> _edit(Map<String, dynamic>? row) async {
    var parents = <Map<String, dynamic>>[];
    if (row == null && _type != 'campus') {
      final parentPlural = _type == 'block'
          ? 'campuses'
          : _type == 'floor'
              ? 'blocks'
              : 'floors';
      try {
        final raw =
            await widget.client.get('/admin/$parentPlural?status=ACTIVE');
        parents = (raw as List<dynamic>)
            .whereType<Map>()
            .map((value) => Map<String, dynamic>.from(value))
            .toList();
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Active parent locations unavailable: $error')),
          );
        }
        return;
      }
    }
    if (!mounted) return;
    final code = TextEditingController(text: row?['code']?.toString());
    final name = TextEditingController(text: row?['name']?.toString());
    final parent = TextEditingController(
      text: row?[_type == 'block'
              ? 'campusId'
              : _type == 'floor'
                  ? 'blockId'
                  : 'floorId']
          ?.toString(),
    );
    final extra = TextEditingController(
      text: _type == 'floor'
          ? '${row?['level'] ?? 0}'
          : '${row?['capacity'] ?? 70}',
    );
    var roomType = row?['roomType']?.toString() ?? 'CLASSROOM';
    var active = row?['isActive'] != false;
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('${row == null ? 'Add' : 'Edit'} $_type'),
          content: SizedBox(
            width: 460,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: code,
                    decoration: const InputDecoration(labelText: 'Code'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Name'),
                  ),
                  if (row == null && _type != 'campus') ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue:
                          parents.any((value) => value['id'] == parent.text)
                              ? parent.text
                              : null,
                      decoration: InputDecoration(
                        labelText: _type == 'block'
                            ? 'Campus'
                            : _type == 'floor'
                                ? 'Block'
                                : 'Floor',
                      ),
                      items: parents
                          .map(
                            (value) => DropdownMenuItem(
                              value: value['id'].toString(),
                              child: Text(
                                '${value['name']} (${value['code']})',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (value) => parent.text = value ?? '',
                    ),
                    if (parents.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                          'Create an active parent location before adding this record.',
                        ),
                      ),
                  ],
                  if (_type == 'floor' || _type == 'room') ...[
                    const SizedBox(height: 10),
                    TextField(
                      controller: extra,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: _type == 'floor' ? 'Floor number' : 'Capacity',
                      ),
                    ),
                  ],
                  if (_type == 'room') ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: roomType,
                      decoration: const InputDecoration(labelText: 'Room type'),
                      items: _roomTypes
                          .map((value) => DropdownMenuItem(
                              value: value, child: Text(value.replaceAll('_', ' '))))
                          .toList(),
                      onChanged: (value) =>
                          setDialogState(() => roomType = value ?? roomType),
                    ),
                  ],
                  SwitchListTile(
                    value: active,
                    title: const Text('Active'),
                    onChanged: (value) =>
                        setDialogState(() => active = value),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (saved == true) {
      final body = <String, dynamic>{
        'code': code.text.trim().toUpperCase(),
        'name': name.text.trim(),
        'isActive': active,
        if (row == null && _type == 'block') 'campusId': parent.text.trim(),
        if (row == null && _type == 'floor') 'blockId': parent.text.trim(),
        if (row == null && _type == 'room') 'floorId': parent.text.trim(),
        if (_type == 'floor') 'level': int.tryParse(extra.text) ?? 0,
        if (_type == 'room') ...{
          'roomType': roomType,
          'capacity': int.tryParse(extra.text) ?? 70,
        },
      };
      await _action(() => row == null
          ? widget.client.post('/admin/$_plural', body)
          : widget.client.patch('/admin/$_plural/${row['id']}', body));
    }
    code.dispose();
    name.dispose();
    parent.dispose();
    extra.dispose();
  }
}
