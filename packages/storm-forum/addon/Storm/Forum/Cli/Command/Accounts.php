<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class Accounts extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void
    {
        $this->setName('storm:accounts')->setDescription('Apply the authorized RiotShielder-to-jerred production account merge.')
            ->addOption('stage', null, InputOption::VALUE_REQUIRED);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $stage = $input->getOption('stage');
        if (!in_array($stage, ['beta','prod'], true)) { throw new \RuntimeException('An explicit forum stage is required.'); }
        if ($stage !== 'prod') { $output->writeln('No production identity migration requested.'); return 0; }
        $app = \XF::app();
        $users = $app->registry()->get('stormForumHistoricalUsers');
        $entry = $users[1] ?? null; // Original archived RiotShielder identity, not a username guess.
        $target = $app->em()->find('XF:User', 1);
        if (!$entry || $entry['aliases'] !== ['RiotShielder'] || !$target || !$target->is_admin
            || strtolower($target->username) !== 'jerred' || $target->email === '' || $target->user_state !== 'valid') {
            throw new \RuntimeException('Production account migration targets do not match the reviewed identities.');
        }
        if ($entry['userId'] === $target->user_id && !empty($entry['claimed'])) {
            $output->writeln('Historical RiotShielder identity already belongs to jerred.'); return 0;
        }
        $source = $app->em()->find('XF:User', $entry['userId']);
        if (!$source || $source->username !== 'RiotShielder' || $source->email !== '' || $source->is_admin || $source->is_moderator
            || $source->Auth->getAuthenticationHandler()->hasPassword()) {
            throw new \RuntimeException('The historical merge source is no longer an unclaimed archived profile.');
        }
        \XF::asVisitor($target, function () use ($app, $source, $target) {
            $merger = $app->service('XF:User\Merge');
            $merger->setSource($source)->setTarget($target);
            if (!$merger->merge()->isCompleted()) { throw new \RuntimeException('Production account merge did not finish.'); }
        });
        $output->writeln('RiotShielder merged into jerred; historical labels and current login retained.');
        return 0;
    }
}
