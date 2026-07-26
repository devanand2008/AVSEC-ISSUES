import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import '../../core/storage/encrypted_message_cache.dart';
import '../academic/section_management_screen.dart';
import '../admin/bulk_user_import_screen.dart';
import '../admin/data_maintenance_screen.dart';
import '../attendance/attendance_excel_screen.dart';
import '../auth/auth_user.dart';
import '../campus/campus_setup_screen.dart';
import '../learning/learning_home_screen.dart';
import '../messaging/conversations_screen.dart';
import '../messaging/message_storage_settings_screen.dart';
import '../people/people_list_screen.dart';
import '../skill_portal/skill_dashboard_screen.dart';

class AvsAppShell extends StatefulWidget {
  const AvsAppShell({
    super.key,
    required this.user,
    required this.client,
    required this.onLogout,
    this.messageCache,
    this.messageCacheError,
  });

  final AuthUser user;
  final AvsApiClient client;
  final EncryptedMessageCache? messageCache;
  final Object? messageCacheError;
  final Future<void> Function() onLogout;

  @override
  State<AvsAppShell> createState() => _AvsAppShellState();
}

class _AvsAppShellState extends State<AvsAppShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final isAdmin = widget.user.roles.any(
      (role) => ['SUPER_ADMIN', 'MAIN_ADMIN', 'PRINCIPAL'].contains(role),
    );
    final pages = isAdmin
        ? [
            _Dashboard(user: widget.user),
            CampusSetupScreen(client: widget.client),
            PeopleListScreen(client: widget.client),
            SectionManagementScreen(client: widget.client),
            AttendanceExcelScreen(client: widget.client),
            ConversationsScreen(
              client: widget.client,
              user: widget.user,
              cache: widget.messageCache,
              cacheError: widget.messageCacheError,
            ),
            _AdminMore(
              client: widget.client,
              user: widget.user,
              cache: widget.messageCache,
              cacheError: widget.messageCacheError,
              onLogout: widget.onLogout,
            ),
          ]
        : [
            _Dashboard(user: widget.user),
            const _SimplePage(
              title: 'Attendance',
              icon: Icons.fact_check_outlined,
            ),
            const _LearnHub(),
            ConversationsScreen(
              client: widget.client,
              user: widget.user,
              cache: widget.messageCache,
              cacheError: widget.messageCacheError,
            ),
            _Profile(
              user: widget.user,
              client: widget.client,
              cache: widget.messageCache,
              cacheError: widget.messageCacheError,
              onLogout: widget.onLogout,
            ),
          ];
    final destinations = isAdmin
        ? const [
            NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              label: 'Dashboard',
            ),
            NavigationDestination(
              icon: Icon(Icons.location_city_outlined),
              label: 'Campus',
            ),
            NavigationDestination(
              icon: Icon(Icons.group_outlined),
              label: 'People',
            ),
            NavigationDestination(
              icon: Icon(Icons.account_tree_outlined),
              label: 'Academic',
            ),
            NavigationDestination(
              icon: Icon(Icons.fact_check_outlined),
              label: 'Attendance',
            ),
            NavigationDestination(
              icon: Icon(Icons.forum_outlined),
              label: 'Messenger',
            ),
            NavigationDestination(
              icon: Icon(Icons.more_horiz),
              label: 'More',
            ),
          ]
        : const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.fact_check_outlined),
              label: 'Attendance',
            ),
            NavigationDestination(
              icon: Icon(Icons.menu_book_outlined),
              label: 'Learn',
            ),
            NavigationDestination(
              icon: Icon(Icons.chat_bubble_outline),
              label: 'Messages',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              label: 'Profile',
            ),
          ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 760;
        return Scaffold(
          appBar: AppBar(title: Text(_title(_index, isAdmin))),
          drawer: !wide && isAdmin
              ? NavigationDrawer(
                  selectedIndex: _index,
                  onDestinationSelected: (value) {
                    setState(() => _index = value);
                    Navigator.of(context).pop();
                  },
                  children: destinations
                      .map(
                        (item) => NavigationDrawerDestination(
                          icon: item.icon,
                          label: Text(item.label),
                        ),
                      )
                      .toList(),
                )
              : null,
          body: wide
              ? Row(
                  children: [
                    NavigationRail(
                      selectedIndex: _index,
                      onDestinationSelected: (value) =>
                          setState(() => _index = value),
                      labelType: NavigationRailLabelType.all,
                      destinations: destinations
                          .map(
                            (item) => NavigationRailDestination(
                              icon: item.icon,
                              label: Text(item.label),
                            ),
                          )
                          .toList(),
                    ),
                    const VerticalDivider(width: 1),
                    Expanded(child: pages[_index]),
                  ],
                )
              : pages[_index],
          bottomNavigationBar: wide || isAdmin
              ? null
              : NavigationBar(
                  selectedIndex: _index,
                  onDestinationSelected: (value) =>
                      setState(() => _index = value),
                  destinations: destinations,
                ),
        );
      },
    );
  }

  String _title(int index, bool isAdmin) {
    return (isAdmin
        ? const [
            'Dashboard',
            'Campus setup',
            'People',
            'Academic',
            'Attendance Excel',
            'Messenger',
            'Administration',
          ]
        : const [
            'AVS College',
            'Attendance',
            'Learn',
            'Messages',
            'Profile',
          ])[index];
  }
}

class _LearnHub extends StatelessWidget {
  const _LearnHub();

  @override
  Widget build(BuildContext context) {
    return const DefaultTabController(
      length: 2,
      child: Column(
        children: [
          TabBar(
            tabs: [
              Tab(icon: Icon(Icons.code), text: 'AVS Skill'),
              Tab(icon: Icon(Icons.menu_book), text: 'AVS Learn'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: [
                SkillDashboardScreen(),
                LearningHomeScreen(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Dashboard extends StatelessWidget {
  const _Dashboard({required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          'Welcome, ${user.fullName}',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 18),
        const ListTile(
          leading: Icon(Icons.campaign_outlined),
          title: Text('Announcements'),
          subtitle: Text('No new announcements'),
        ),
        const ListTile(
          leading: Icon(Icons.schedule_outlined),
          title: Text('Today'),
          subtitle: Text('Your academic schedule'),
        ),
      ],
    );
  }
}

class _AdminMore extends StatelessWidget {
  const _AdminMore({
    required this.client,
    required this.user,
    required this.cache,
    required this.cacheError,
    required this.onLogout,
  });

  final AvsApiClient client;
  final AuthUser user;
  final EncryptedMessageCache? cache;
  final Object? cacheError;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        ListTile(
          leading: const Icon(Icons.upload_file),
          title: const Text('Data Import Centre'),
          subtitle: const Text(
            'People, academic, campus, attendance, assets and routing workbooks',
          ),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => BulkUserImportScreen(client: client),
            ),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.cleaning_services_outlined),
          title: const Text('Data maintenance wizard'),
          subtitle: const Text('Dry run, backup verification, execute, audit'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => DataMaintenanceScreen(client: client),
            ),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.lock_outline),
          title: const Text('Message storage and backup'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => MessageStorageSettingsScreen(
                client: client,
                cache: cache,
                cacheError: cacheError,
              ),
            ),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.code),
          title: const Text('AVS Skill'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const SkillDashboardScreen()),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.menu_book_outlined),
          title: const Text('AVS Learn'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const LearningHomeScreen()),
          ),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.person_outline),
          title: Text(user.fullName),
          subtitle: Text(user.email ?? user.roles.join(', ')),
        ),
        OutlinedButton.icon(
          onPressed: onLogout,
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ],
    );
  }
}

class _SimplePage extends StatelessWidget {
  const _SimplePage({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [Icon(icon, size: 42), const SizedBox(height: 10), Text(title)],
      ),
    );
  }
}

class _Profile extends StatelessWidget {
  const _Profile({
    required this.user,
    required this.client,
    required this.cache,
    required this.cacheError,
    required this.onLogout,
  });

  final AuthUser user;
  final AvsApiClient client;
  final EncryptedMessageCache? cache;
  final Object? cacheError;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        CircleAvatar(
          radius: 34,
          child: Text(user.fullName.isEmpty ? 'A' : user.fullName[0]),
        ),
        const SizedBox(height: 12),
        Text(
          user.fullName,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        if (user.email != null)
          Text(user.email!, textAlign: TextAlign.center),
        const SizedBox(height: 24),
        ListTile(
          leading: const Icon(Icons.lock_outline),
          title: const Text('Message storage and backup'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => MessageStorageSettingsScreen(
                client: client,
                cache: cache,
                cacheError: cacheError,
              ),
            ),
          ),
        ),
        OutlinedButton.icon(
          onPressed: onLogout,
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ],
    );
  }
}
